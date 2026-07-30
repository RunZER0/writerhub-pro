const crypto = require('crypto');
const { pool } = require('../db');
const { notifyMember, sendMemberEmail, reportEmailTemplate, buildReportAttachment, refundToWallet } = require('./turnitin');

// Mounted directly in server.js with express.raw({ type: 'application/json' }),
// BEFORE the global express.json() body parser, so req.body is the untouched
// raw Buffer needed for HMAC verification (see plan notes on why the Paystack
// webhook's raw-body check is unreliable under the global JSON parser).
module.exports = async function writenixWebhook(req, res) {
    try {
        const signature = req.headers['x-writenix-signature'];
        const secret = process.env.WRITENIX_WEBHOOK_SECRET;

        if (!signature || !secret) {
            return res.status(401).json({ error: 'Missing signature' });
        }

        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
        const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

        const signatureBuffer = Buffer.from(signature);
        const computedBuffer = Buffer.from(computed);
        if (signatureBuffer.length !== computedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, computedBuffer)) {
            return res.status(403).json({ error: 'Invalid signature' });
        }

        const payload = JSON.parse(rawBody.toString('utf8'));
        const event = payload.event;

        // Per Writenix's documented webhook payload, the match field is report_id. Older
        // fallback field names are kept defensively in case a payload variant ever omits it.
        const writenixRef = payload.report_id || payload.document_id || payload.reference || payload.id
            || payload.data?.report_id || payload.data?.document_id || payload.data?.reference || payload.data?.id;

        if (!writenixRef) {
            console.error('Writenix webhook missing a matchable reference:', JSON.stringify(payload));
            return res.status(200).json({ received: true });
        }

        const reportResult = await pool.query(
            `SELECT wr.*, cm.name as member_name, cm.email as member_email
             FROM writenix_reports wr
             JOIN client_members cm ON wr.member_id = cm.id
             WHERE wr.writenix_reference = $1`,
            [writenixRef]
        );

        if (reportResult.rows.length === 0) {
            console.error(`Writenix webhook: no report found for reference ${writenixRef}`);
            return res.status(200).json({ received: true });
        }

        const report = reportResult.rows[0];
        const member = { name: report.member_name, email: report.member_email };

        if (event === 'report.completed') {
            // Documented shape: payload.files.report_1 = similarity report, report_2 = AI report —
            // two separate downloadable files, not one URL with numeric score fields.
            const files = payload.files || payload.data?.files || {};
            const similarityReportUrl = files.report_1 || null;
            const aiReportUrl = files.report_2 || null;

            await pool.query(
                `UPDATE writenix_reports
                 SET status = 'completed', similarity_report_url = $1, ai_report_url = $2,
                     webhook_payload = $3, completed_at = NOW()
                 WHERE id = $4`,
                [similarityReportUrl, aiReportUrl, JSON.stringify(payload), report.id]
            );

            await notifyMember(
                report.member_id,
                'Your report is ready',
                `Your check for "${report.original_filename}" is complete. You can download it from the Plagiarism Check tab.`,
                '/client#turnitin',
                'turnitin_ready'
            );

            // Attach both report files so the client has them immediately in their inbox, in
            // addition to staying downloadable from the portal at any time later.
            const attachments = (await Promise.all([
                buildReportAttachment(similarityReportUrl, report.original_filename, 'Similarity Report'),
                buildReportAttachment(aiReportUrl, report.original_filename, 'AI Report')
            ])).filter(Boolean);

            await sendMemberEmail(
                member.email,
                member.name,
                'Your plagiarism/AI report is ready',
                reportEmailTemplate({
                    heading: `Hi ${member.name}, your report is ready!`,
                    intro: `Your check for "${report.original_filename}" has finished processing.${attachments.length ? ' The full report(s) are attached to this email.' : ''}`,
                    bodyLines: [],
                    ctaText: 'View in Dashboard',
                    ctaUrl: `${process.env.BASE_URL || 'https://www.homeworkpal.online'}/client#turnitin`
                }),
                attachments
            );
        } else if (event === 'report.refunded' || event === 'report.cancelled') {
            const reason = event === 'report.cancelled'
                ? 'processing was cancelled'
                : 'the file was rejected during moderation';

            await pool.query(
                `UPDATE writenix_reports SET status = 'refunded', webhook_payload = $1 WHERE id = $2`,
                [JSON.stringify(payload), report.id]
            );
            await refundToWallet(report.id, report.member_id, member, reason);
        } else {
            console.log(`Unhandled Writenix webhook event: ${event}`);
        }

        res.status(200).json({ received: true });
    } catch (error) {
        console.error('Writenix webhook error:', error);
        // Still 200 to avoid pointless retry storms once we've logged it; only signature failures are rejected above.
        res.status(200).json({ received: true, error: 'internal' });
    }
};

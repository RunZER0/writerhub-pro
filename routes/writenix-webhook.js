const crypto = require('crypto');
const { pool } = require('../db');
const { notifyMember, sendMemberEmail, reportEmailTemplate, refundToWallet, DISPUTE_EMAIL } = require('./turnitin');

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

        // Writenix's exact identifier field isn't pinned down in their public docs snippet,
        // so match defensively against whatever they actually send.
        const writenixRef = payload.document_id || payload.reference || payload.id || payload.data?.document_id || payload.data?.reference || payload.data?.id;

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
            const data = payload.data || payload;
            const reportUrl = data.report_url || data.download_url || data.file_url || null;
            const similarityScore = data.similarity_score ?? data.similarity ?? null;
            const aiScore = data.ai_score ?? data.ai_similarity ?? null;

            await pool.query(
                `UPDATE writenix_reports
                 SET status = 'completed', report_url = $1, similarity_score = $2, ai_score = $3,
                     webhook_payload = $4, completed_at = NOW()
                 WHERE id = $5`,
                [reportUrl, similarityScore, aiScore, JSON.stringify(payload), report.id]
            );

            await notifyMember(
                report.member_id,
                'Your report is ready',
                `Your check for "${report.original_filename}" is complete. You can download it from the Plagiarism Check tab.`,
                '/client#turnitin',
                'turnitin_ready'
            );

            await sendMemberEmail(
                member.email,
                member.name,
                'Your plagiarism/AI report is ready',
                reportEmailTemplate({
                    heading: `Hi ${member.name}, your report is ready!`,
                    intro: `Your check for "${report.original_filename}" has finished processing.`,
                    bodyLines: [],
                    ctaText: reportUrl ? 'Download Report' : 'View in Dashboard',
                    ctaUrl: reportUrl || `${process.env.BASE_URL || 'https://www.homeworkpal.online'}/client#turnitin`
                })
            );
        } else if (event === 'report.refunded') {
            await pool.query(
                `UPDATE writenix_reports SET status = 'refunded', webhook_payload = $1 WHERE id = $2`,
                [JSON.stringify(payload), report.id]
            );
            await refundToWallet(report.id, report.member_id, member, 'the file was rejected during moderation');
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

const { pool } = require('../db');
const writenixClient = require('../writenix/client');
const { notifyMember, sendMemberEmail, reportEmailTemplate, buildReportAttachment, refundToWallet } = require('./turnitin');

// Mounted directly in server.js with express.raw({ type: 'application/json' }),
// BEFORE the global express.json() body parser, so req.body is the untouched
// raw Buffer needed for HMAC verification.
module.exports = async function writenixWebhook(req, res) {
    const reqId = Date.now().toString(36).toUpperCase(); // trace ID for log correlation
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, '..', 'webhook-debug.log');

    const logToDebug = (msg) => {
        const line = `[${new Date().toISOString()}] ${msg}\n`;
        try { fs.appendFileSync(logFile, line); } catch(e) {}
        console.log(msg);
    };

    logToDebug(`[WNX-${reqId}] Webhook arrived. Headers: ${JSON.stringify({
        'x-writenix-signature': req.headers['x-writenix-signature'] ? '(present)' : '(MISSING)',
        'content-type': req.headers['content-type'],
        'content-length': req.headers['content-length'],
        'user-agent': req.headers['user-agent'],
    })}`);

    try {
        const signature = req.headers['x-writenix-signature'];

        // Safely extract raw bytes — express.raw() gives us a Buffer, but if it
        // didn't match the content-type the body is undefined. Handle all cases.
        let rawBody;
        if (Buffer.isBuffer(req.body)) {
            rawBody = req.body;
        } else if (req.body && typeof req.body === 'object') {
            rawBody = Buffer.from(JSON.stringify(req.body));
        } else if (typeof req.body === 'string') {
            rawBody = Buffer.from(req.body, 'utf8');
        } else {
            logToDebug(`[WNX-${reqId}] req.body is empty/undefined. Incoming CT: ${req.headers['content-type']}`);
            return res.status(400).json({ error: 'Could not read request body' });
        }

        logToDebug(`[WNX-${reqId}] Raw body (first 500 chars): ${rawBody.toString('utf8').slice(0, 500)}`);

        // --- Signature verification ---
        // In development or when WRITENIX_WEBHOOK_SECRET is not set we allow unsigned
        // webhooks so local testing and webhook resends from the Writenix dashboard
        // (which may not re-sign) still work. Production MUST have the secret set.
        const isDev = (process.env.NODE_ENV || 'development') !== 'production';
        const hasSecret = !!process.env.WRITENIX_WEBHOOK_SECRET;

        if (!signature && !hasSecret) {
            logToDebug(`[WNX-${reqId}] No signature and no WRITENIX_WEBHOOK_SECRET — allowing (dev/unconfigured mode).`);
        } else if (!signature) {
            logToDebug(`[WNX-${reqId}] REJECTED: Signature header missing.`);
            return res.status(401).json({ error: 'Missing signature' });
        } else if (!hasSecret) {
            logToDebug(`[WNX-${reqId}] WRITENIX_WEBHOOK_SECRET not configured — skipping signature check.`);
        } else {
            const sigValid = writenixClient.verifyWebhookSignature(signature, rawBody);
            if (!sigValid) {
                // Log the mismatch detail to help diagnose key mismatches
                const crypto = require('crypto');
                const computed = crypto.createHmac('sha256', process.env.WRITENIX_WEBHOOK_SECRET)
                    .update(rawBody).digest('hex');
                logToDebug(`[WNX-${reqId}] REJECTED: Signature mismatch.`);
                logToDebug(`[WNX-${reqId}]   Received : ${signature}`);
                logToDebug(`[WNX-${reqId}]   Expected : ${computed}`);

                // In dev allow it through with a warning so the flow can be debugged end-to-end
                if (isDev) {
                    logToDebug(`[WNX-${reqId}] Dev mode: proceeding despite signature mismatch.`);
                } else {
                    return res.status(403).json({ error: 'Invalid signature' });
                }
            } else {
                logToDebug(`[WNX-${reqId}] Signature verified OK.`);
            }
        }

        // --- Parse payload ---
        let payload;
        try {
            payload = JSON.parse(rawBody.toString('utf8'));
        } catch (parseErr) {
            logToDebug(`[WNX-${reqId}] Failed to parse JSON body: ${parseErr.message}`);
            return res.status(400).json({ error: 'Invalid JSON' });
        }

        logToDebug(`[WNX-${reqId}] Parsed payload keys: ${Object.keys(payload).join(', ')}`);

        const { event, writenixRef, similarityReportUrl, aiReportUrl, similarityScore, aiScore } =
            writenixClient.parseWebhookPayload(payload);

        logToDebug(`[WNX-${reqId}] event="${event}" ref="${writenixRef}" sim="${similarityReportUrl}" ai="${aiReportUrl}"`);

        if (!writenixRef) {
            logToDebug(`[WNX-${reqId}] No matchable reference in payload. Full payload: ${JSON.stringify(payload)}`);
            return res.status(200).json({ received: true, warning: 'no_reference' });
        }

        // --- Look up local report ---
        const reportResult = await pool.query(
            `SELECT wr.*, cm.name as member_name, cm.email as member_email
             FROM writenix_reports wr
             JOIN client_members cm ON wr.member_id = cm.id
             WHERE wr.writenix_reference = $1`,
            [writenixRef]
        );

        if (reportResult.rows.length === 0) {
            logToDebug(`[WNX-${reqId}] No report row found for reference "${writenixRef}". All known references:`);
            try {
                const allRefs = await pool.query(`SELECT id, writenix_reference, status, created_at FROM writenix_reports ORDER BY created_at DESC LIMIT 10`);
                allRefs.rows.forEach(r => logToDebug(`  id=${r.id} ref=${r.writenix_reference} status=${r.status}`));
            } catch (_) {}
            return res.status(200).json({ received: true, warning: 'no_report_found' });
        }

        const report = reportResult.rows[0];
        const member = { name: report.member_name, email: report.member_email };
        logToDebug(`[WNX-${reqId}] Matched local report id=${report.id} status=${report.status} filename="${report.original_filename}"`);

        // --- Handle events ---
        if (event === 'report.completed') {
            await pool.query(
                `UPDATE writenix_reports
                 SET status = 'completed', similarity_report_url = $1, ai_report_url = $2,
                     similarity_score = $3, ai_score = $4,
                     webhook_payload = $5, completed_at = NOW()
                 WHERE id = $6`,
                [similarityReportUrl, aiReportUrl, similarityScore, aiScore, JSON.stringify(payload), report.id]
            );
            logToDebug(`[WNX-${reqId}] ✅ Report ${report.id} marked completed. sim_url=${similarityReportUrl} ai_url=${aiReportUrl}`);

            await notifyMember(
                report.member_id,
                'Your report is ready',
                `Your check for "${report.original_filename}" is complete. You can download it from the Plagiarism Check tab.`,
                '/client#turnitin',
                'turnitin_ready'
            );

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
            logToDebug(`[WNX-${reqId}] Report ${report.id} marked refunded (event: ${event}).`);
            await refundToWallet(report.id, report.member_id, member, reason);

        } else {
            logToDebug(`[WNX-${reqId}] Unhandled event type: "${event}". Payload logged above.`);
        }

        res.status(200).json({ received: true });

    } catch (error) {
        logToDebug(`[WNX-${reqId}] Unhandled error in webhook handler: ${error.stack || error.message}`);
        // Always 200 to prevent Writenix from retrying a payload that's already causing a crash.
        res.status(200).json({ received: true, error: 'internal' });
    }
};

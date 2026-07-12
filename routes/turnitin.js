const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { isAdminBypassEmail } = require('../utils/admin-emails');

const Brevo = require('@getbrevo/brevo');
const brevoApi = new Brevo.TransactionalEmailsApi();
brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

const TURNITIN_PRICE_KES = 200;
const TURNITIN_PRICE_USD = 2;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const DISPUTE_EMAIL = 'valdaceai@gmail.com';

// ---- Auth (client_members JWT, same shape as routes/membership.js) ----
function authenticateMember(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'homework-pal-secret');
        if (decoded.type !== 'client_member') {
            return res.status(403).json({ error: 'Invalid token type' });
        }
        req.member = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ---- Upload handling ----
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '..', 'uploads', 'turnitin');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.doc', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF and Word documents (.pdf, .doc, .docx) are accepted'));
        }
    }
});

// ---- Helpers ----
async function verifyPaystackTransaction(reference) {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}` }
    });
    const data = await response.json();
    if (!data.status) return null;
    return data.data;
}

async function notifyMember(memberId, title, message, link, type = 'info') {
    try {
        await pool.query(
            `INSERT INTO member_notifications (member_id, title, message, type, link)
             VALUES ($1, $2, $3, $4, $5)`,
            [memberId, title, message, type, link || null]
        );
    } catch (error) {
        console.error('Error creating member notification:', error.message);
    }
}

function reportEmailTemplate({ heading, intro, bodyLines, ctaText, ctaUrl }) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .header h1 { color: white; margin: 0; font-size: 26px; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
                .content h2 { color: #1e293b; }
                .content p { color: #475569; }
                .cta-btn { display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #64748b; font-size: 12px; }
                .support { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; font-size: 14px; color: #475569; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header"><h1>🎓 HomeworkPal</h1></div>
                <div class="content">
                    <h2>${heading}</h2>
                    <p>${intro}</p>
                    ${bodyLines.map(l => `<p>${l}</p>`).join('')}
                    ${ctaUrl ? `<div style="text-align:center;"><a href="${ctaUrl}" class="cta-btn">${ctaText}</a></div>` : ''}
                    <div class="support">
                        Questions or need a hand? Reach us at <strong>${DISPUTE_EMAIL}</strong>.
                    </div>
                </div>
                <div class="footer">
                    <p>© ${new Date().getFullYear()} HomeworkPal. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

async function sendMemberEmail(email, name, subject, html, attachment) {
    try {
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.sender = { name: 'HomeworkPal', email: process.env.SENDER_EMAIL || 'noreply@homeworkpal.com' };
        sendSmtpEmail.to = [{ email, name }];
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = html;
        if (attachment) {
            sendSmtpEmail.attachment = [attachment]; // { content: base64String, name: 'filename.pdf' }
        }
        await brevoApi.sendTransacEmail(sendSmtpEmail);
        return true;
    } catch (error) {
        console.error('Failed to send report email:', error?.body || error.message);
        return false;
    }
}

// Fetches the report PDF so it can ride along as an email attachment. Brevo's transactional
// API caps total message size around 10MB, so this skips attaching (falls back to the portal
// link only) if the file is unexpectedly large rather than risking the whole send failing.
async function buildReportAttachment(reportUrl, originalFilename) {
    if (!reportUrl) return null;
    try {
        const response = await fetch(reportUrl);
        if (!response.ok) return null;

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 9 * 1024 * 1024) {
            console.error(`Report PDF too large to attach (${buffer.length} bytes), sending link-only email`);
            return null;
        }

        const baseName = originalFilename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'report';
        return { content: buffer.toString('base64'), name: `${baseName} - Report.pdf` };
    } catch (error) {
        console.error('Failed to fetch report PDF for email attachment:', error.message);
        return null;
    }
}

async function refundToWallet(reportId, memberId, member, reason) {
    // Atomically credit 1 check back to the member's Turnitin wallet
    await pool.query(
        `UPDATE client_members SET turnitin_wallet_credits = turnitin_wallet_credits + 1 WHERE id = $1`,
        [memberId]
    );

    const message = `Your document check couldn't be completed (${reason}). We've credited 1 free check back to your account — no charge was lost. If you'd prefer a cash refund instead, email ${DISPUTE_EMAIL} with your request.`;

    await notifyMember(memberId, 'Check refunded to your wallet', message, null, 'turnitin_refund');

    await sendMemberEmail(
        member.email,
        member.name,
        'Your plagiarism check was refunded to your wallet',
        reportEmailTemplate({
            heading: `Hi ${member.name}, your check couldn't be completed`,
            intro: message,
            bodyLines: [],
            ctaText: 'Try Again',
            ctaUrl: `${process.env.BASE_URL || 'https://www.homeworkpal.online'}/client#turnitin`
        })
    );
}

// ============ ROUTES ============

// Pricing + wallet balance for the logged-in member
router.get('/pricing', authenticateMember, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT turnitin_wallet_credits, email FROM client_members WHERE id = $1',
            [req.member.memberId]
        );
        res.json({
            kes: TURNITIN_PRICE_KES,
            usd: TURNITIN_PRICE_USD,
            walletCredits: result.rows[0]?.turnitin_wallet_credits || 0,
            isAdmin: isAdminBypassEmail(result.rows[0]?.email)
        });
    } catch (error) {
        console.error('Error fetching turnitin pricing:', error);
        res.status(500).json({ error: 'Failed to load pricing' });
    }
});

// Submit a document for checking
router.post('/submit', authenticateMember, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    const memberId = req.member.memberId;
    let uploadedFilePath = req.file ? req.file.path : null;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Please attach a PDF or Word document' });
        }

        const memberResult = await pool.query(
            'SELECT id, name, email, turnitin_wallet_credits FROM client_members WHERE id = $1',
            [memberId]
        );
        if (memberResult.rows.length === 0) {
            fs.unlink(uploadedFilePath, () => {});
            return res.status(404).json({ error: 'Member not found' });
        }
        const member = memberResult.rows[0];

        const useWallet = req.body.useWallet === 'true';
        let usedWalletCredit = false;
        let amountCharged = null;
        let currency = null;
        let paystackReference = null;
        const isAdmin = isAdminBypassEmail(member.email);

        if (isAdmin) {
            // Admin accounts skip payment/wallet entirely.
        } else if (useWallet) {
            const decrement = await pool.query(
                `UPDATE client_members
                 SET turnitin_wallet_credits = turnitin_wallet_credits - 1
                 WHERE id = $1 AND turnitin_wallet_credits > 0
                 RETURNING turnitin_wallet_credits`,
                [memberId]
            );
            if (decrement.rows.length === 0) {
                fs.unlink(uploadedFilePath, () => {});
                return res.status(400).json({ error: 'You have no free checks available' });
            }
            usedWalletCredit = true;
        } else {
            paystackReference = req.body.paystackReference;
            if (!paystackReference) {
                fs.unlink(uploadedFilePath, () => {});
                return res.status(400).json({ error: 'Payment reference is required' });
            }

            const alreadyUsed = await pool.query(
                'SELECT id FROM writenix_reports WHERE paystack_reference = $1',
                [paystackReference]
            );
            if (alreadyUsed.rows.length > 0) {
                fs.unlink(uploadedFilePath, () => {});
                return res.status(400).json({ error: 'This payment has already been used for a check' });
            }

            const transaction = await verifyPaystackTransaction(paystackReference);
            if (!transaction || transaction.status !== 'success') {
                fs.unlink(uploadedFilePath, () => {});
                return res.status(400).json({ error: 'We could not verify your payment' });
            }

            const paidAmount = transaction.amount / 100;
            const paidCurrency = (transaction.currency || '').toUpperCase();
            const expectedAmount = paidCurrency === 'KES' ? TURNITIN_PRICE_KES : TURNITIN_PRICE_USD;

            if (Math.abs(paidAmount - expectedAmount) > 0.01) {
                fs.unlink(uploadedFilePath, () => {});
                return res.status(400).json({ error: 'Payment amount does not match the check fee' });
            }

            amountCharged = paidAmount;
            currency = paidCurrency;
        }

        const relativeFilePath = `/uploads/turnitin/${path.basename(uploadedFilePath)}`;
        const insertResult = await pool.query(
            `INSERT INTO writenix_reports
                (member_id, original_filename, file_path, status, amount_charged, currency, paystack_reference, used_wallet_credit)
             VALUES ($1, $2, $3, 'processing', $4, $5, $6, $7)
             RETURNING id`,
            [memberId, req.file.originalname, relativeFilePath, amountCharged, currency, paystackReference, usedWalletCredit]
        );
        const reportId = insertResult.rows[0].id;

        // Forward to Writenix
        try {
            const fileBuffer = fs.readFileSync(uploadedFilePath);
            const formData = new FormData();
            formData.append('file', new Blob([fileBuffer]), req.file.originalname);

            const writenixResponse = await fetch('https://app.writenix.com/api/v1/documents/process', {
                method: 'POST',
                headers: { 'X-Api-Key': process.env.WRITENIX_API_KEY },
                body: formData
            });

            if (!writenixResponse.ok) {
                const errBody = await writenixResponse.text().catch(() => '');
                throw new Error(`Writenix returned ${writenixResponse.status}: ${errBody}`);
            }

            const writenixData = await writenixResponse.json().catch(() => ({}));
            const writenixReference = writenixData.reference || writenixData.document_id || writenixData.id || null;

            await pool.query(
                'UPDATE writenix_reports SET writenix_reference = $1 WHERE id = $2',
                [writenixReference, reportId]
            );

            return res.json({ success: true, reportId, status: 'processing' });
        } catch (writenixError) {
            console.error('Writenix submission failed:', writenixError.message);

            await pool.query(
                "UPDATE writenix_reports SET status = 'failed' WHERE id = $1",
                [reportId]
            );
            await refundToWallet(reportId, memberId, member, 'a system issue on our end');

            return res.status(502).json({
                success: false,
                error: 'We could not submit your document right now. 1 check has been credited back to your account.'
            });
        }
    } catch (error) {
        console.error('Error submitting turnitin check:', error);
        if (uploadedFilePath) fs.unlink(uploadedFilePath, () => {});
        res.status(500).json({ error: 'Failed to submit document' });
    }
});

// List the member's reports
router.get('/my-reports', authenticateMember, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, original_filename, status, similarity_score, ai_score, created_at, completed_at
             FROM writenix_reports
             WHERE member_id = $1
             ORDER BY created_at DESC`,
            [req.member.memberId]
        );
        res.json({ reports: result.rows });
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// Download a completed report — proxied (not redirected) so it downloads with a friendly
// filename and never exposes Writenix's underlying (possibly signed/expiring) URL to the client.
router.get('/download/:id', authenticateMember, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM writenix_reports WHERE id = $1 AND member_id = $2',
            [req.params.id, req.member.memberId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        const report = result.rows[0];
        if (report.status !== 'completed' || !report.report_url) {
            return res.status(400).json({ error: 'Report is not ready yet' });
        }

        try {
            const upstream = await fetch(report.report_url);
            if (!upstream.ok || !upstream.body) {
                throw new Error(`Upstream returned ${upstream.status}`);
            }

            const baseName = report.original_filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'report';
            const contentType = upstream.headers.get('content-type') || 'application/pdf';

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${baseName} - Report.pdf"`);

            Readable.fromWeb(upstream.body).pipe(res);
        } catch (proxyError) {
            // Fall back to a plain redirect rather than leaving the user stuck if the proxy fetch fails
            console.error('Report proxy download failed, falling back to redirect:', proxyError.message);
            res.redirect(report.report_url);
        }
    } catch (error) {
        console.error('Error downloading report:', error);
        res.status(500).json({ error: 'Failed to download report' });
    }
});

module.exports = router;
module.exports.notifyMember = notifyMember;
module.exports.reportEmailTemplate = reportEmailTemplate;
module.exports.sendMemberEmail = sendMemberEmail;
module.exports.buildReportAttachment = buildReportAttachment;
module.exports.refundToWallet = refundToWallet;
module.exports.DISPUTE_EMAIL = DISPUTE_EMAIL;

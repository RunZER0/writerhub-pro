const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { isDisposableEmail } = require('../utils/disposable-emails');

const Brevo = require('@getbrevo/brevo');
const brevoApi = new Brevo.TransactionalEmailsApi();
brevoApi.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const DISPUTE_EMAIL = 'valdaceai@gmail.com';
const BASE_URL = process.env.BASE_URL || 'https://www.homeworkpal.online';

// ---- Helpers ----

async function generateClientCode() {
    for (let attempt = 0; attempt < 10; attempt++) {
        const suffix = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
        const code = `HP-${suffix}`;
        const existing = await pool.query('SELECT id FROM quickpay_clients WHERE client_code = $1', [code]);
        if (existing.rows.length === 0) return code;
    }
    throw new Error('Could not generate a unique client code');
}

function generateInvoiceNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `QP${year}${month}-${random}`;
}

async function sendBrevoEmail(email, name, subject, html) {
    try {
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.sender = { name: 'HomeworkPal', email: process.env.SENDER_EMAIL || 'noreply@homeworkpal.com' };
        sendSmtpEmail.to = [{ email, name }];
        sendSmtpEmail.subject = subject;
        sendSmtpEmail.htmlContent = html;
        await brevoApi.sendTransacEmail(sendSmtpEmail);
        return true;
    } catch (error) {
        console.error('QuickPay email failed:', error?.body || error.message);
        return false;
    }
}

function verificationEmailHtml(name, clientCode, verifyUrl) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #10b981, #059669); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .header h1 { color: white; margin: 0; font-size: 26px; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
                .verify-btn { display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header"><h1>⚡ Quick Pay</h1></div>
                <div class="content">
                    <h2>Hi ${name},</h2>
                    <p>Click below to verify your email and get your Client Code. You'll need it every time you use Quick Pay.</p>
                    <div style="text-align:center;"><a href="${verifyUrl}" class="verify-btn">Verify &amp; Get My Client Code</a></div>
                    <p style="color:#666; font-size:14px;">This link expires in 24 hours. If you didn't request this, ignore this email.</p>
                </div>
                <div class="footer"><p>© ${new Date().getFullYear()} HomeworkPal. All rights reserved.</p></div>
            </div>
        </body>
        </html>
    `;
}

function verificationResultPage(status, message, clientCode) {
    const statusConfig = {
        success: { icon: '✓', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)' },
        error: { icon: '✗', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
        expired: { icon: '⏰', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' }
    };
    const config = statusConfig[status] || statusConfig.error;

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Quick Pay Verification - HomeworkPal</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
                .container { background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 40px; max-width: 480px; text-align: center; }
                .icon { width: 80px; height: 80px; border-radius: 50%; background: ${config.bgColor}; color: ${config.color}; display: flex; align-items: center; justify-content: center; font-size: 40px; margin: 0 auto 20px; }
                h1 { color: white; margin-bottom: 15px; font-size: 24px; }
                p { color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 20px; }
                .code-box { background: rgba(16,185,129,0.12); border: 1px dashed #10b981; border-radius: 12px; padding: 20px; margin: 20px 0; }
                .code-label { color: rgba(255,255,255,0.5); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
                .code-value { color: #10b981; font-size: 28px; font-weight: 700; letter-spacing: 2px; font-family: 'Courier New', monospace; }
                .copy-btn { margin-top: 12px; background: rgba(16,185,129,0.15); border: 1px solid #10b981; color: #10b981; padding: 8px 18px; border-radius: 8px; font-size: 13px; cursor: pointer; }
                .btn { display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: 600; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">${config.icon}</div>
                <h1>${status === 'success' ? "You're verified!" : status === 'expired' ? 'Link Expired' : 'Verification Failed'}</h1>
                <p>${message}</p>
                ${clientCode ? `
                <div class="code-box">
                    <div class="code-label">Your Client Code</div>
                    <div class="code-value" id="clientCode">${clientCode}</div>
                    <button class="copy-btn" onclick="navigator.clipboard.writeText('${clientCode}'); this.textContent='Copied!'">Copy Code</button>
                </div>
                <p style="font-size:13px;">Keep this code — you'll enter it every time you use Quick Pay.</p>
                ` : ''}
                <a href="${BASE_URL}/" class="btn">${status === 'success' ? 'Back to Site' : 'Back to Homepage'}</a>
            </div>
        </body>
        </html>
    `;
}

function buildAgreementText({ clientName, clientCode, clientEmail, amount, currency, workPaidFor, invoiceNumber, serverDateTime }) {
    return `This confirms that ${clientName} (Client Code ${clientCode}, ${clientEmail}) authorizes payment of ${currency} ${amount} to HomeworkPal for: "${workPaidFor}". This agreement was made on ${serverDateTime} and, together with the invoice issued at the time of this payment (Invoice #${invoiceNumber}), constitutes the agreed record of this transaction between the parties for the purposes of resolving any future dispute. Client Code ${clientCode} serves as the identifying signature of the paying party. For any dispute or refund request relating to this payment, contact ${DISPUTE_EMAIL} with the Invoice Number and Client Code above.`;
}

function invoiceHtml(invoice, isConfirmation) {
    const created = new Date(invoice.created_at || Date.now());
    const formattedDate = created.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Invoice #${invoice.invoice_number}</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .receipt { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; text-align: center; }
        .logo { font-size: 28px; font-weight: bold; margin-bottom: 5px; }
        .logo span { color: #fbbf24; }
        .tagline { opacity: 0.9; font-size: 14px; }
        .content { padding: 30px; }
        .order-info { background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 25px; }
        .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { color: #64748b; }
        .info-value { font-weight: 600; color: #1e293b; text-align: right; }
        .amount-block { text-align: center; padding: 25px; background: #f0fdf4; border-radius: 8px; margin-bottom: 25px; }
        .amount-value { font-size: 36px; font-weight: bold; color: #059669; }
        .status-badge { display: inline-block; margin-top: 10px; padding: 6px 18px; border-radius: 20px; font-weight: 600; font-size: 13px; background: ${invoice.payment_status === 'paid' ? '#22c55e' : '#eab308'}; color: white; }
        .agreement { background: #f8fafc; border-left: 3px solid #10b981; border-radius: 4px; padding: 18px 20px; margin-bottom: 25px; font-size: 13px; color: #475569; line-height: 1.7; }
        .agreement h3 { margin: 0 0 10px; color: #334155; font-size: 14px; }
        .footer { text-align: center; padding: 20px 30px 30px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 13px; }
        .support { margin-top: 15px; padding: 15px; background: #f8fafc; border-radius: 8px; }
    </style>
</head>
<body>
    <div class="receipt">
        <div class="header">
            <div class="logo">Homework<span>Pal</span></div>
            <div class="tagline">Quick Pay Invoice</div>
        </div>
        <div class="content">
            <div class="order-info">
                <div class="info-row"><span class="info-label">Invoice Number</span><span class="info-value">${invoice.invoice_number}</span></div>
                <div class="info-row"><span class="info-label">Date Generated</span><span class="info-value">${formattedDate}</span></div>
                <div class="info-row"><span class="info-label">Client Name</span><span class="info-value">${invoice.client_name}</span></div>
                <div class="info-row"><span class="info-label">Client Code</span><span class="info-value">${invoice.client_code}</span></div>
                <div class="info-row"><span class="info-label">Email</span><span class="info-value">${invoice.client_email}</span></div>
                <div class="info-row"><span class="info-label">Work Paid For</span><span class="info-value">${invoice.work_paid_for}</span></div>
            </div>
            <div class="amount-block">
                <div class="amount-value">${invoice.currency} ${parseFloat(invoice.amount).toFixed(2)}</div>
                <div class="status-badge">${invoice.payment_status === 'paid' ? '✓ PAID' : '⏳ AWAITING PAYMENT'}</div>
            </div>
            <div class="agreement">
                <h3>Signed Agreement</h3>
                ${invoice.agreement_text}
            </div>
            <div class="support">
                <strong>Disputes &amp; Refunds</strong><br>
                Email: <a href="mailto:${DISPUTE_EMAIL}">${DISPUTE_EMAIL}</a> — include your Invoice Number and Client Code.
            </div>
        </div>
        <div class="footer">
            <p>This invoice was generated automatically by HomeworkPal at the moment payment was initiated${isConfirmation ? '' : ', regardless of whether payment was completed'}.</p>
            <p><a href="${BASE_URL}">${BASE_URL.replace('https://', '')}</a></p>
        </div>
    </div>
</body>
</html>
    `;
}

async function verifyPaystackTransaction(reference) {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}` }
    });
    const data = await response.json();
    if (!data.status) return null;
    return data.data;
}

// ============ ROUTES ============

// Sign up for a Client Code
router.post('/signup', async (req, res) => {
    try {
        const { name, email } = req.body;
        if (!name || !email) {
            return res.status(400).json({ error: 'Name and email are required' });
        }

        const emailLower = email.toLowerCase().trim();
        if (isDisposableEmail(emailLower)) {
            return res.status(400).json({ error: 'Temporary or disposable email addresses are not allowed' });
        }

        const existing = await pool.query('SELECT * FROM quickpay_clients WHERE email = $1', [emailLower]);

        if (existing.rows.length > 0) {
            const client = existing.rows[0];
            if (client.is_verified) {
                return res.status(400).json({ error: 'This email already has a Client Code. Check your inbox from when you signed up, or contact support.' });
            }
            // Resend verification
            const newToken = crypto.randomBytes(32).toString('hex');
            const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await pool.query(
                'UPDATE quickpay_clients SET verification_token = $1, token_expiry = $2, name = $3 WHERE id = $4',
                [newToken, tokenExpiry, name, client.id]
            );
            const resendSent = await sendBrevoEmail(
                emailLower, name, 'Verify your email — Quick Pay',
                verificationEmailHtml(name, null, `${BASE_URL}/api/quickpay/verify?token=${newToken}`)
            );
            if (!resendSent) {
                // Don't let an email provider hiccup strand someone from getting their code (same fallback membership.js uses)
                await pool.query(
                    `UPDATE quickpay_clients SET is_verified = TRUE, verification_token = NULL, token_expiry = NULL WHERE id = $1`,
                    [client.id]
                );
                return res.json({ success: true, needsVerification: false, clientCode: client.client_code, message: `Your Client Code is ${client.client_code}. Save it — you'll need it every time you use Quick Pay.` });
            }
            return res.json({ success: true, needsVerification: true, message: `We've sent a new verification link to ${emailLower}.` });
        }

        const clientCode = await generateClientCode();
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await pool.query(
            `INSERT INTO quickpay_clients (client_code, name, email, verification_token, token_expiry, is_verified)
             VALUES ($1, $2, $3, $4, $5, FALSE)`,
            [clientCode, name, emailLower, verificationToken, tokenExpiry]
        );

        const emailSent = await sendBrevoEmail(
            emailLower, name, 'Verify your email — Quick Pay',
            verificationEmailHtml(name, null, `${BASE_URL}/api/quickpay/verify?token=${verificationToken}`)
        );

        if (!emailSent) {
            await pool.query(
                `UPDATE quickpay_clients SET is_verified = TRUE, verification_token = NULL, token_expiry = NULL WHERE email = $1`,
                [emailLower]
            );
            return res.json({ success: true, needsVerification: false, clientCode, message: `Your Client Code is ${clientCode}. Save it — you'll need it every time you use Quick Pay.` });
        }

        res.json({ success: true, needsVerification: true, message: `We've sent a verification link to ${emailLower}. Click it to get your Client Code.` });
    } catch (error) {
        console.error('QuickPay signup error:', error);
        res.status(500).json({ error: 'Signup failed. Please try again.' });
    }
});

// Verify email, one click, shows the Client Code
router.get('/verify', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.status(400).send(verificationResultPage('error', 'Invalid verification link.'));
        }

        const result = await pool.query(
            'SELECT id, name, email, client_code, token_expiry FROM quickpay_clients WHERE verification_token = $1',
            [token]
        );
        if (result.rows.length === 0) {
            return res.status(400).send(verificationResultPage('error', 'Invalid or expired verification link.'));
        }

        const client = result.rows[0];
        if (client.token_expiry && new Date(client.token_expiry) < new Date()) {
            return res.status(400).send(verificationResultPage('expired', 'This verification link has expired. Please sign up again to get a new one.'));
        }

        await pool.query(
            `UPDATE quickpay_clients SET is_verified = TRUE, verification_token = NULL, token_expiry = NULL WHERE id = $1`,
            [client.id]
        );

        res.send(verificationResultPage('success', `Welcome, ${client.name}! Your email is verified.`, client.client_code));
    } catch (error) {
        console.error('QuickPay verify error:', error);
        res.status(500).send(verificationResultPage('error', 'Verification failed. Please try again.'));
    }
});

// Look up a Client Code (used to gate Quick Pay)
router.get('/code/:code', async (req, res) => {
    try {
        const code = (req.params.code || '').trim().toUpperCase();
        const result = await pool.query(
            `SELECT client_code, name, email FROM quickpay_clients
             WHERE client_code = $1 AND is_verified = TRUE AND status = 'active'`,
            [code]
        );
        if (result.rows.length === 0) {
            return res.json({ found: false });
        }
        const client = result.rows[0];
        res.json({ found: true, name: client.name, email: client.email, clientCode: client.client_code });
    } catch (error) {
        console.error('QuickPay code lookup error:', error);
        res.status(500).json({ error: 'Lookup failed' });
    }
});

// Generate + send the invoice/agreement BEFORE payment happens
router.post('/invoice', async (req, res) => {
    try {
        const { clientCode, workPaidFor, amount, currency, clientLocalTime, clientTimezone } = req.body;

        if (!clientCode || !workPaidFor || !amount || !currency) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const parsedAmount = parseFloat(amount);
        if (!parsedAmount || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const code = clientCode.trim().toUpperCase();
        const clientResult = await pool.query(
            `SELECT * FROM quickpay_clients WHERE client_code = $1 AND is_verified = TRUE AND status = 'active'`,
            [code]
        );
        if (clientResult.rows.length === 0) {
            return res.status(404).json({ error: 'We can\'t find that Client Code' });
        }
        const client = clientResult.rows[0];

        const invoiceNumber = generateInvoiceNumber();
        const serverDateTime = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'long', timeZone: 'UTC' });

        const agreementText = buildAgreementText({
            clientName: client.name,
            clientCode: client.client_code,
            clientEmail: client.email,
            amount: parsedAmount.toFixed(2),
            currency: currency.toUpperCase(),
            workPaidFor,
            invoiceNumber,
            serverDateTime
        });

        const insertResult = await pool.query(
            `INSERT INTO quickpay_invoices
                (invoice_number, client_code, client_name, client_email, work_paid_for, amount, currency,
                 agreement_text, agreement_accepted_at, client_local_time, client_timezone, payment_status, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, 'invoice_sent', $11)
             RETURNING *`,
            [
                invoiceNumber, client.client_code, client.name, client.email, workPaidFor,
                parsedAmount, currency.toUpperCase(), agreementText,
                clientLocalTime || null, clientTimezone || null,
                req.ip
            ]
        );
        const invoice = insertResult.rows[0];

        await pool.query('UPDATE quickpay_clients SET last_used_at = NOW() WHERE id = $1', [client.id]);

        await sendBrevoEmail(
            client.email, client.name,
            `Invoice #${invoiceNumber} — HomeworkPal Quick Pay`,
            invoiceHtml(invoice, false)
        );

        res.json({ success: true, invoiceNumber });
    } catch (error) {
        console.error('QuickPay invoice error:', error);
        res.status(500).json({ error: 'Failed to generate invoice' });
    }
});

// Mark an invoice paid after Paystack payment succeeds (server-side re-verified, not trusted blindly)
router.post('/invoice/:invoiceNumber/paid', async (req, res) => {
    try {
        const { invoiceNumber } = req.params;
        const { paystackReference } = req.body;
        if (!paystackReference) {
            return res.status(400).json({ error: 'Payment reference is required' });
        }

        const invoiceResult = await pool.query(
            'SELECT * FROM quickpay_invoices WHERE invoice_number = $1',
            [invoiceNumber]
        );
        if (invoiceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        const invoice = invoiceResult.rows[0];

        const refUsed = await pool.query(
            'SELECT id FROM quickpay_invoices WHERE paystack_reference = $1 AND id != $2',
            [paystackReference, invoice.id]
        );
        if (refUsed.rows.length > 0) {
            return res.status(400).json({ error: 'This payment reference has already been used' });
        }

        const transaction = await verifyPaystackTransaction(paystackReference);
        if (!transaction || transaction.status !== 'success') {
            return res.status(400).json({ error: 'We could not verify your payment' });
        }

        const paidAmount = transaction.amount / 100;
        if (Math.abs(paidAmount - parseFloat(invoice.amount)) > 0.01) {
            return res.status(400).json({ error: 'Paid amount does not match the invoice' });
        }

        await pool.query(
            `UPDATE quickpay_invoices SET payment_status = 'paid', paid_at = NOW(), paystack_reference = $1 WHERE id = $2`,
            [paystackReference, invoice.id]
        );

        res.json({ success: true, invoiceNumber });
    } catch (error) {
        console.error('QuickPay mark-paid error:', error);
        res.status(500).json({ error: 'Failed to confirm payment' });
    }
});

// Printable invoice
router.get('/invoice/:invoiceNumber/download', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM quickpay_invoices WHERE invoice_number = $1',
            [req.params.invoiceNumber]
        );
        if (result.rows.length === 0) {
            return res.status(404).send('Invoice not found');
        }
        res.send(invoiceHtml(result.rows[0], result.rows[0].payment_status === 'paid'));
    } catch (error) {
        console.error('QuickPay invoice download error:', error);
        res.status(500).send('Failed to load invoice');
    }
});

module.exports = router;

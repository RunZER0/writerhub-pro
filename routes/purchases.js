const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

function authenticateMember(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];
    if (!token && req.query && req.query.token) {
        token = req.query.token;
    }
    
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

// GET /api/purchases/my-purchases — Returns unified list of all client purchases & invoices
router.get('/my-purchases', authenticateMember, async (req, res) => {
    try {
        const memberId = req.member.memberId;
        // client_members has no client_code column — the QuickPay code lives on
        // quickpay_clients, matched by email.
        const memberRes = await pool.query(
            `SELECT cm.name, cm.email, qc.client_code
             FROM client_members cm
             LEFT JOIN quickpay_clients qc ON LOWER(qc.email) = LOWER(cm.email)
             WHERE cm.id = $1`,
            [memberId]
        );

        if (memberRes.rows.length === 0) {
            return res.status(404).json({ error: 'Member profile not found' });
        }
        const member = memberRes.rows[0];

        // 1. Fetch Plagiarism & AI Check reports
        const turnitinRes = await pool.query(
            `SELECT id, original_filename, status, amount_charged, currency, paystack_reference, created_at, writenix_reference, used_wallet_credit
             FROM writenix_reports
             WHERE member_id = $1
             ORDER BY created_at DESC`,
            [memberId]
        );

        // 2. Fetch QuickPay Invoices (by client_code or email match)
        const quickpayRes = await pool.query(
            `SELECT id, invoice_number, client_code, client_email, work_paid_for, amount, currency, payment_status, paystack_reference, created_at, paid_at
             FROM quickpay_invoices
             WHERE client_code = $1 OR LOWER(client_email) = LOWER($2)
             ORDER BY created_at DESC`,
            [member.client_code, member.email]
        );

        // 3. Fetch Client Orders / Assignment Payments
        // client_orders is the member-facing order record. Column names here must match the
        // table as it actually exists (package_type / final_price), not the topic/budget/currency
        // fields an earlier version of this query assumed — those don't exist and made the whole
        // endpoint 500.
        const ordersRes = await pool.query(
            `SELECT co.id, co.order_number, co.package_type, co.pages, co.final_price,
                    co.payment_status, co.created_at, co.paid_at, a.title
             FROM client_orders co
             LEFT JOIN assignments a ON co.assignment_id = a.id
             WHERE co.member_id = $1
             ORDER BY co.created_at DESC`,
            [memberId]
        );

        // 4. Fetch Report Slot Bundle purchases
        let slotRows = [];
        try {
            const slotRes = await pool.query(
                `SELECT id, slot_count, amount, currency, paystack_reference, created_at
                 FROM slot_purchases
                 WHERE member_id = $1
                 ORDER BY created_at DESC`,
                [memberId]
            );
            slotRows = slotRes.rows;
        } catch (e) {
            // Table may not exist yet on an un-migrated database
        }

        // Combine into unified purchases array
        const purchases = [];

        slotRows.forEach(s => {
            purchases.push({
                id: `slot_${s.id}`,
                raw_id: s.id,
                type: 'slot_purchase',
                type_label: 'Report Slot Bundle',
                badge_icon: 'fa-layer-group',
                title: `${s.slot_count} report check slots`,
                description: `Pre-paid bundle of ${s.slot_count} plagiarism & AI report checks`,
                reference: `SLOT-${s.id}`,
                payment_reference: s.paystack_reference || 'N/A',
                amount: parseFloat(s.amount || 0),
                currency: s.currency || 'USD',
                status: 'paid',
                status_label: 'Paid',
                date: s.created_at
            });
        });

        // Map Turnitin
        turnitinRes.rows.forEach(r => {
            const amount = r.amount_charged ? parseFloat(r.amount_charged) : (r.currency === 'KES' ? 300 : 8);
            const currency = r.currency || 'USD';
            purchases.push({
                id: `wnx_${r.id}`,
                raw_id: r.id,
                type: 'plagiarism_check',
                type_label: 'Plagiarism & AI Check',
                badge_icon: 'fa-microchip',
                title: `Check: "${r.original_filename}"`,
                description: r.used_wallet_credit ? 'Paid via Wallet Credit' : `Plagiarism & AI Scan for ${r.original_filename}`,
                reference: r.writenix_reference ? `WNX-${r.writenix_reference}` : `WNX-${r.id}`,
                payment_reference: r.paystack_reference || 'N/A',
                amount: amount,
                currency: currency,
                status: r.status === 'completed' ? 'paid' : (r.status === 'refunded' ? 'refunded' : r.status),
                status_label: r.status === 'completed' ? 'Paid & Ready' : (r.status === 'refunded' ? 'Refunded' : 'Processing'),
                date: r.created_at
            });
        });

        // Map QuickPay Invoices
        quickpayRes.rows.forEach(q => {
            purchases.push({
                id: `qp_${q.id}`,
                raw_id: q.id,
                type: 'quickpay_invoice',
                type_label: 'QuickPay Invoice',
                badge_icon: 'fa-receipt',
                title: q.work_paid_for || `Invoice ${q.invoice_number}`,
                description: `Official QuickPay Invoice #${q.invoice_number}`,
                reference: q.invoice_number,
                payment_reference: q.paystack_reference || 'Pending',
                amount: parseFloat(q.amount || 0),
                currency: q.currency || 'KES',
                status: q.payment_status === 'paid' ? 'paid' : 'pending',
                status_label: q.payment_status === 'paid' ? 'Paid' : 'Pending',
                date: q.paid_at || q.created_at
            });
        });

        // Map Assignment Orders
        ordersRes.rows.forEach(o => {
            purchases.push({
                id: `ord_${o.id}`,
                raw_id: o.id,
                type: 'assignment_order',
                type_label: 'Homework Order',
                badge_icon: 'fa-file-invoice',
                title: o.title || `Order ${o.order_number}`,
                description: `Assignment Order #${o.order_number} (${o.package_type || 'Standard'}${o.pages ? `, ${o.pages} pages` : ''})`,
                reference: o.order_number || `HW-${o.id}`,
                payment_reference: 'Card/Mobile',
                amount: parseFloat(o.final_price || 0),
                currency: 'USD',
                status: o.payment_status === 'paid' ? 'paid' : (o.payment_status || 'pending'),
                status_label: o.payment_status === 'paid' ? 'Paid' : 'Pending',
                date: o.paid_at || o.created_at
            });
        });

        // Sort descending by date
        purchases.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({
            success: true,
            member: {
                name: member.name,
                email: member.email,
                client_code: member.client_code
            },
            purchases
        });
    } catch (error) {
        console.error('Error fetching my purchases:', error);
        res.status(500).json({ error: 'Failed to load purchases' });
    }
});

// GET /api/purchases/invoice/:type/:id — Generates detailed invoice data for viewing/printing
router.get('/invoice/:type/:id', authenticateMember, async (req, res) => {
    try {
        const { type, id } = req.params;
        const memberId = req.member.memberId;

        const memberRes = await pool.query(
            `SELECT cm.name, cm.email, qc.client_code
             FROM client_members cm
             LEFT JOIN quickpay_clients qc ON LOWER(qc.email) = LOWER(cm.email)
             WHERE cm.id = $1`,
            [memberId]
        );
        if (memberRes.rows.length === 0) return res.status(404).json({ error: 'Member not found' });
        const member = memberRes.rows[0];

        let invoiceData = null;

        if (type === 'plagiarism_check' || type === 'wnx') {
            const r = await pool.query(
                'SELECT * FROM writenix_reports WHERE id = $1 AND member_id = $2',
                [id, memberId]
            );
            if (r.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
            const item = r.rows[0];
            const amount = item.amount_charged ? parseFloat(item.amount_charged) : (item.currency === 'KES' ? 300 : 8);
            const currency = item.currency || 'USD';

            invoiceData = {
                invoice_number: `INV-WNX-${item.id}`,
                title: 'Plagiarism & AI Detection Report',
                date: item.created_at,
                payment_date: item.completed_at || item.created_at,
                status: item.status === 'completed' ? 'PAID' : (item.status === 'refunded' ? 'REFUNDED' : 'PROCESSING'),
                currency: currency,
                billed_to: {
                    name: member.name,
                    email: member.email,
                    client_code: member.client_code
                },
                items: [
                    {
                        description: `Plagiarism & AI Scan: "${item.original_filename}"`,
                        reference: item.writenix_reference ? `WNX-${item.writenix_reference}` : `ID-#${item.id}`,
                        qty: 1,
                        unit_price: amount,
                        total: amount
                    }
                ],
                subtotal: amount,
                tax: 0,
                total: amount,
                payment_method: item.used_wallet_credit ? 'Wallet Credit' : 'Online Gateway',
                payment_reference: item.paystack_reference || 'N/A'
            };

        } else if (type === 'quickpay_invoice' || type === 'qp') {
            const r = await pool.query(
                'SELECT * FROM quickpay_invoices WHERE id = $1 AND (client_code = $2 OR LOWER(client_email) = LOWER($3))',
                [id, member.client_code, member.email]
            );
            if (r.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
            const item = r.rows[0];
            const amount = parseFloat(item.amount || 0);

            invoiceData = {
                invoice_number: item.invoice_number,
                title: 'QuickPay Custom Invoice',
                date: item.created_at,
                payment_date: item.paid_at || item.created_at,
                status: item.payment_status === 'paid' ? 'PAID' : 'PENDING',
                currency: item.currency || 'KES',
                billed_to: {
                    name: member.name,
                    email: member.email,
                    client_code: item.client_code
                },
                items: [
                    {
                        description: item.work_paid_for || 'QuickPay Custom Invoice',
                        reference: item.invoice_number,
                        qty: 1,
                        unit_price: amount,
                        total: amount
                    }
                ],
                subtotal: amount,
                tax: 0,
                total: amount,
                payment_method: 'Paystack / Card / Mobile Money',
                payment_reference: item.paystack_reference || 'N/A'
            };

        } else if (type === 'assignment_order' || type === 'ord') {
            const r = await pool.query(
                `SELECT co.*, a.title
                 FROM client_orders co
                 LEFT JOIN assignments a ON co.assignment_id = a.id
                 WHERE co.id = $1 AND co.member_id = $2`,
                [id, memberId]
            );
            if (r.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
            const item = r.rows[0];
            const amount = parseFloat(item.final_price || 0);

            invoiceData = {
                invoice_number: item.order_number || `INV-HW-${item.id}`,
                title: 'Homework Assignment Service',
                date: item.created_at,
                payment_date: item.paid_at || item.created_at,
                status: item.payment_status === 'paid' ? 'PAID' : 'PENDING',
                currency: 'USD',
                billed_to: {
                    name: member.name,
                    email: member.email,
                    client_code: member.client_code
                },
                items: [
                    {
                        description: `Assignment: "${item.title || item.order_number}" (${item.package_type || 'Standard'})`,
                        reference: item.order_number || `HW-${item.id}`,
                        qty: 1,
                        unit_price: amount,
                        total: amount
                    }
                ],
                subtotal: amount,
                tax: 0,
                total: amount,
                payment_method: 'Online Gateway',
                payment_reference: 'Card/Mobile'
            };
        } else if (type === 'slot_purchase' || type === 'slot') {
            const r = await pool.query(
                'SELECT * FROM slot_purchases WHERE id = $1 AND member_id = $2',
                [id, memberId]
            );
            if (r.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
            const item = r.rows[0];
            const amount = parseFloat(item.amount || 0);

            invoiceData = {
                invoice_number: `INV-SLOT-${item.id}`,
                title: 'Report Check Slot Bundle',
                date: item.created_at,
                payment_date: item.created_at,
                status: 'PAID',
                currency: item.currency || 'USD',
                billed_to: {
                    name: member.name,
                    email: member.email,
                    client_code: member.client_code
                },
                items: [
                    {
                        description: `${item.slot_count} pre-paid plagiarism & AI report check slots`,
                        reference: `SLOT-${item.id}`,
                        qty: item.slot_count,
                        unit_price: item.slot_count ? amount / item.slot_count : amount,
                        total: amount
                    }
                ],
                subtotal: amount,
                tax: 0,
                total: amount,
                payment_method: 'Paystack / Card / Mobile Money',
                payment_reference: item.paystack_reference || 'N/A'
            };

        } else {
            return res.status(400).json({ error: 'Invalid invoice type' });
        }

        res.json({ success: true, invoice: invoiceData });
    } catch (error) {
        console.error('Error generating invoice:', error);
        res.status(500).json({ error: 'Failed to generate invoice' });
    }
});

module.exports = router;

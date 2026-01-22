const express = require('express');
const db = require('../db');
const { authenticate, isAdmin } = require('../middleware/auth');
const { sendEmail, emailTemplates } = require('../utils/email');

const router = express.Router();

// Get payment summary (Admin sees all, writers see their own)
router.get('/summary', authenticate, async (req, res) => {
    try {
        let query;
        let params = [];

        if (req.user.role === 'admin') {
            query = `
                SELECT u.id, u.name, u.email,
                       COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completed_assignments,
                       COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.amount ELSE 0 END), 0) as total_earned,
                       COALESCE((SELECT SUM(amount) FROM payments WHERE writer_id = u.id), 0) as total_paid
                FROM users u
                LEFT JOIN assignments a ON a.writer_id = u.id
                WHERE u.role = 'writer'
                GROUP BY u.id
                HAVING COUNT(a.id) > 0 OR (SELECT COUNT(*) FROM payments WHERE writer_id = u.id) > 0
                ORDER BY u.name
            `;
        } else {
            query = `
                SELECT u.id, u.name, u.email,
                       COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completed_assignments,
                       COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.amount ELSE 0 END), 0) as total_earned,
                       COALESCE((SELECT SUM(amount) FROM payments WHERE writer_id = u.id), 0) as total_paid
                FROM users u
                LEFT JOIN assignments a ON a.writer_id = u.id
                WHERE u.id = $1
                GROUP BY u.id
            `;
            params = [req.user.id];
        }

        const result = await db.query(query, params);

        const summary = result.rows.map(row => ({
            ...row,
            balance_owed: parseFloat(row.total_earned) - parseFloat(row.total_paid)
        }));

        res.json(summary);
    } catch (error) {
        console.error('Get payment summary error:', error);
        res.status(500).json({ error: 'Failed to get payment summary' });
    }
});

// Get payment history
router.get('/history', authenticate, async (req, res) => {
    try {
        let query;
        let params = [];

        if (req.user.role === 'admin') {
            query = `
                SELECT p.*, u.name as writer_name, u.email as writer_email
                FROM payments p
                JOIN users u ON p.writer_id = u.id
                ORDER BY p.payment_date DESC, p.created_at DESC
            `;
        } else {
            query = `
                SELECT p.*, u.name as writer_name, u.email as writer_email
                FROM payments p
                JOIN users u ON p.writer_id = u.id
                WHERE p.writer_id = $1
                ORDER BY p.payment_date DESC, p.created_at DESC
            `;
            params = [req.user.id];
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Get payment history error:', error);
        res.status(500).json({ error: 'Failed to get payment history' });
    }
});

// Record payment (Admin only)
router.post('/', authenticate, isAdmin, async (req, res) => {
    try {
        const { writer_id, amount, payment_date, method, reference, notes } = req.body;

        if (!writer_id || !amount || !payment_date) {
            return res.status(400).json({ error: 'Writer, amount, and payment date are required' });
        }

        // Get writer info
        const writerResult = await db.query(
            'SELECT name, email FROM users WHERE id = $1 AND role = $2',
            [writer_id, 'writer']
        );

        if (writerResult.rows.length === 0) {
            return res.status(400).json({ error: 'Writer not found' });
        }

        const writer = writerResult.rows[0];

        // Record payment
        const result = await db.query(`
            INSERT INTO payments (writer_id, amount, payment_date, method, reference, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [writer_id, amount, payment_date, method || 'bank-transfer', reference || null, notes || null]);

        const payment = result.rows[0];

        // Update completed assignments as paid (up to the amount)
        await db.query(`
            UPDATE assignments 
            SET payment_status = 'paid', updated_at = NOW()
            WHERE writer_id = $1 
            AND status = 'completed' 
            AND payment_status = 'unpaid'
        `, [writer_id]);

        // Send email notification
        const emailContent = emailTemplates.paymentReceived(writer.name, payment);
        sendEmail(writer.email, emailContent.subject, emailContent.html);

        // Create in-app notification
        await db.query(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES ($1, $2, $3, $4)
        `, [writer_id, 'Payment Received', `You received a payment of $${amount}`, 'payment']);

        res.status(201).json({
            ...payment,
            writer_name: writer.name
        });
    } catch (error) {
        console.error('Record payment error:', error);
        res.status(500).json({ error: 'Failed to record payment' });
    }
});

// Get totals (Admin only)
router.get('/totals', authenticate, isAdmin, async (req, res) => {
    try {
        const totalsResult = await db.query(`
            SELECT 
                COALESCE(SUM(amount), 0) as total_paid
            FROM payments
        `);

        const pendingResult = await db.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.amount ELSE 0 END), 0) as total_earned,
                COALESCE((SELECT SUM(amount) FROM payments), 0) as total_paid
            FROM assignments a
        `);

        const totalPaid = parseFloat(totalsResult.rows[0].total_paid);
        const totalEarned = parseFloat(pendingResult.rows[0].total_earned);
        const totalPending = totalEarned - totalPaid;

        res.json({
            total_paid: totalPaid,
            total_pending: Math.max(0, totalPending)
        });
    } catch (error) {
        console.error('Get totals error:', error);
        res.status(500).json({ error: 'Failed to get totals' });
    }
});

module.exports = router;

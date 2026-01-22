const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get dashboard stats
router.get('/stats', authenticate, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            // Admin dashboard stats
            const stats = await db.query(`
                SELECT
                    (SELECT COUNT(*) FROM users WHERE role = 'writer') as total_writers,
                    (SELECT COUNT(*) FROM assignments WHERE status IN ('pending', 'in-progress')) as active_assignments,
                    (SELECT COUNT(*) FROM assignments WHERE status = 'completed' 
                     AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)) as completed_this_month,
                    (SELECT COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) 
                     FROM assignments) as total_earned,
                    (SELECT COALESCE(SUM(amount), 0) FROM payments) as total_paid
            `);

            const row = stats.rows[0];
            const pendingPayments = parseFloat(row.total_earned) - parseFloat(row.total_paid);

            res.json({
                total_writers: parseInt(row.total_writers),
                active_assignments: parseInt(row.active_assignments),
                pending_payments: Math.max(0, pendingPayments),
                completed_this_month: parseInt(row.completed_this_month)
            });
        } else {
            // Writer dashboard stats
            const stats = await db.query(`
                SELECT
                    (SELECT COUNT(*) FROM assignments WHERE writer_id = $1 AND status IN ('pending', 'in-progress')) as active_assignments,
                    (SELECT COUNT(*) FROM assignments WHERE writer_id = $1 AND status = 'completed') as completed_assignments,
                    (SELECT COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) 
                     FROM assignments WHERE writer_id = $1) as total_earned,
                    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE writer_id = $1) as total_paid,
                    (SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false) as unread_notifications
            `, [req.user.id]);

            const row = stats.rows[0];
            const balance = parseFloat(row.total_earned) - parseFloat(row.total_paid);

            res.json({
                active_assignments: parseInt(row.active_assignments),
                completed_assignments: parseInt(row.completed_assignments),
                total_earned: parseFloat(row.total_earned),
                balance_owed: Math.max(0, balance),
                unread_notifications: parseInt(row.unread_notifications)
            });
        }
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Get recent assignments
router.get('/recent-assignments', authenticate, async (req, res) => {
    try {
        let query;
        let params = [];

        if (req.user.role === 'admin') {
            query = `
                SELECT a.*, u.name as writer_name
                FROM assignments a
                LEFT JOIN users u ON a.writer_id = u.id
                ORDER BY a.created_at DESC
                LIMIT 5
            `;
        } else {
            query = `
                SELECT a.*, u.name as writer_name
                FROM assignments a
                LEFT JOIN users u ON a.writer_id = u.id
                WHERE a.writer_id = $1
                ORDER BY a.created_at DESC
                LIMIT 5
            `;
            params = [req.user.id];
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Get recent assignments error:', error);
        res.status(500).json({ error: 'Failed to get recent assignments' });
    }
});

// Get top writers (Admin only)
router.get('/top-writers', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const result = await db.query(`
            SELECT u.id, u.name,
                   COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completed_count,
                   COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.amount ELSE 0 END), 0) as total_earned
            FROM users u
            LEFT JOIN assignments a ON a.writer_id = u.id
            WHERE u.role = 'writer'
            GROUP BY u.id
            HAVING COUNT(CASE WHEN a.status = 'completed' THEN 1 END) > 0
            ORDER BY completed_count DESC
            LIMIT 5
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Get top writers error:', error);
        res.status(500).json({ error: 'Failed to get top writers' });
    }
});

// Get report data (Admin only)
router.get('/report', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { start_date, end_date } = req.query;

        let dateFilter = '';
        let params = [];

        if (start_date && end_date) {
            dateFilter = 'WHERE a.created_at BETWEEN $1 AND $2';
            params = [start_date, end_date + 'T23:59:59'];
        }

        // Overall stats
        const statsQuery = `
            SELECT
                COUNT(*) as total_assignments,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) as total_spent,
                COALESCE(SUM(word_count), 0) as total_words
            FROM assignments a
            ${dateFilter}
        `;

        const statsResult = await db.query(statsQuery, params);
        const stats = statsResult.rows[0];

        const avgRate = parseFloat(stats.total_words) > 0 
            ? parseFloat(stats.total_spent) / parseFloat(stats.total_words) 
            : 0;

        // Writer performance
        const performanceQuery = `
            SELECT u.id, u.name,
                   COUNT(a.id) as assignments,
                   COALESCE(SUM(a.word_count), 0) as words_written,
                   COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completed,
                   COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.amount ELSE 0 END), 0) as earned
            FROM users u
            LEFT JOIN assignments a ON a.writer_id = u.id ${dateFilter ? 'AND' + dateFilter.replace('WHERE', '') : ''}
            WHERE u.role = 'writer'
            GROUP BY u.id
            HAVING COUNT(a.id) > 0
            ORDER BY earned DESC
        `;

        const performanceResult = await db.query(performanceQuery, params);

        res.json({
            total_assignments: parseInt(stats.total_assignments),
            total_spent: parseFloat(stats.total_spent),
            total_words: parseInt(stats.total_words),
            avg_rate: avgRate,
            writer_performance: performanceResult.rows
        });
    } catch (error) {
        console.error('Get report error:', error);
        res.status(500).json({ error: 'Failed to get report' });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate, isAdmin } = require('../middleware/auth');

// Get all finances (admin only)
router.get('/', authenticate, isAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        let query = `
            SELECT 
                af.*,
                a.title,
                a.domain,
                a.status as assignment_status,
                u.name as writer_name,
                a.created_at as assignment_date,
                (af.client_paid - af.writer_cost - af.other_costs) as profit
            FROM assignment_finances af
            JOIN assignments a ON af.assignment_id = a.id
            LEFT JOIN users u ON a.writer_id = u.id AND u.role = 'writer'
            WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            params.push(startDate);
            query += ` AND DATE(a.created_at) >= $${params.length}`;
        }
        if (endDate) {
            params.push(endDate);
            query += ` AND DATE(a.created_at) <= $${params.length}`;
        }

        query += ` ORDER BY a.created_at DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Get finances error:', error);
        res.status(500).json({ error: 'Failed to get finances' });
    }
});

// Get summary stats (admin only)
router.get('/summary', authenticate, isAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        let dateFilter = '';
        const params = [];

        if (startDate) {
            params.push(startDate);
            dateFilter += ` AND DATE(a.created_at) >= $${params.length}`;
        }
        if (endDate) {
            params.push(endDate);
            dateFilter += ` AND DATE(a.created_at) <= $${params.length}`;
        }

        const summaryResult = await pool.query(`
            SELECT 
                COALESCE(SUM(af.client_paid), 0) as total_revenue,
                COALESCE(SUM(af.writer_cost), 0) as total_writer_costs,
                COALESCE(SUM(af.other_costs), 0) as total_other_costs,
                COALESCE(SUM(af.client_paid - af.writer_cost - af.other_costs), 0) as total_profit,
                COUNT(*) as total_orders,
                COUNT(CASE WHEN af.payment_status = 'paid' THEN 1 END) as paid_orders,
                COUNT(CASE WHEN af.payment_status = 'pending' THEN 1 END) as pending_orders
            FROM assignment_finances af
            JOIN assignments a ON af.assignment_id = a.id
            WHERE 1=1 ${dateFilter}
        `, params);

        // Get monthly breakdown for charts
        const monthlyResult = await pool.query(`
            SELECT 
                DATE_TRUNC('month', a.created_at) as month,
                COALESCE(SUM(af.client_paid), 0) as revenue,
                COALESCE(SUM(af.writer_cost + af.other_costs), 0) as costs,
                COALESCE(SUM(af.client_paid - af.writer_cost - af.other_costs), 0) as profit
            FROM assignment_finances af
            JOIN assignments a ON af.assignment_id = a.id
            WHERE a.created_at >= NOW() - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', a.created_at)
            ORDER BY month
        `);

        // Get untracked assignments (assignments without finance records)
        const untrackedResult = await pool.query(`
            SELECT COUNT(*) as count
            FROM assignments a
            LEFT JOIN assignment_finances af ON a.id = af.assignment_id
            WHERE af.id IS NULL AND a.status IN ('completed', 'paid')
        `);

        res.json({
            summary: summaryResult.rows[0],
            monthly: monthlyResult.rows,
            untrackedCount: parseInt(untrackedResult.rows[0].count) || 0
        });
    } catch (error) {
        console.error('Get summary error:', error);
        res.status(500).json({ error: 'Failed to get summary' });
    }
});

// Get finance record for specific assignment
router.get('/assignment/:assignmentId', authenticate, isAdmin, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        
        const result = await pool.query(`
            SELECT af.*, a.title, a.domain, u.name as writer_name
            FROM assignment_finances af
            JOIN assignments a ON af.assignment_id = a.id
            LEFT JOIN users u ON a.writer_id = u.id AND u.role = 'writer'
            WHERE af.assignment_id = $1
        `, [assignmentId]);

        if (result.rows.length === 0) {
            // Return assignment info without finances
            const assignment = await pool.query(`
                SELECT a.id, a.title, a.domain, u.name as writer_name
                FROM assignments a
                LEFT JOIN users u ON a.writer_id = u.id AND u.role = 'writer'
                WHERE a.id = $1
            `, [assignmentId]);
            
            if (assignment.rows.length === 0) {
                return res.status(404).json({ error: 'Assignment not found' });
            }
            
            return res.json({
                assignment_id: parseInt(assignmentId),
                title: assignment.rows[0].title,
                domain: assignment.rows[0].domain,
                writer_name: assignment.rows[0].writer_name,
                client_paid: 0,
                writer_cost: 0,
                other_costs: 0,
                payment_status: 'pending',
                notes: ''
            });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get assignment finance error:', error);
        res.status(500).json({ error: 'Failed to get finance record' });
    }
});

// Create or update finance record for assignment (admin only)
router.post('/assignment/:assignmentId', authenticate, isAdmin, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { client_paid, writer_cost, other_costs, payment_status, notes } = req.body;

        // Upsert - insert or update on conflict
        const result = await pool.query(`
            INSERT INTO assignment_finances (assignment_id, client_paid, writer_cost, other_costs, payment_status, notes, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (assignment_id) 
            DO UPDATE SET 
                client_paid = EXCLUDED.client_paid,
                writer_cost = EXCLUDED.writer_cost,
                other_costs = EXCLUDED.other_costs,
                payment_status = EXCLUDED.payment_status,
                notes = EXCLUDED.notes,
                updated_at = NOW(),
                payment_date = CASE WHEN EXCLUDED.payment_status = 'paid' AND assignment_finances.payment_status != 'paid' THEN NOW() ELSE assignment_finances.payment_date END
            RETURNING *
        `, [assignmentId, client_paid || 0, writer_cost || 0, other_costs || 0, payment_status || 'pending', notes || '']);

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Save finance error:', error);
        res.status(500).json({ error: 'Failed to save finance record' });
    }
});

// Get untracked assignments (no finance records)
router.get('/untracked', authenticate, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.id, a.title, a.domain, a.status, a.amount, u.name as writer_name, a.created_at
            FROM assignments a
            LEFT JOIN assignment_finances af ON a.id = af.assignment_id
            LEFT JOIN users u ON a.writer_id = u.id AND u.role = 'writer'
            WHERE af.id IS NULL AND a.status IN ('completed', 'paid')
            ORDER BY a.created_at DESC
            LIMIT 50
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Get untracked error:', error);
        res.status(500).json({ error: 'Failed to get untracked assignments' });
    }
});

// Bulk create finance records for untracked assignments
router.post('/bulk-create', authenticate, isAdmin, async (req, res) => {
    try {
        const { assignments } = req.body; // Array of { assignmentId, client_paid, writer_cost, other_costs }

        if (!assignments || !Array.isArray(assignments)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        let created = 0;
        for (const a of assignments) {
            try {
                await pool.query(`
                    INSERT INTO assignment_finances (assignment_id, client_paid, writer_cost, other_costs, payment_status)
                    VALUES ($1, $2, $3, $4, 'pending')
                    ON CONFLICT (assignment_id) DO NOTHING
                `, [a.assignmentId, a.client_paid || 0, a.writer_cost || 0, a.other_costs || 0]);
                created++;
            } catch (e) {
                console.error('Bulk create single error:', e);
            }
        }

        res.json({ success: true, created });
    } catch (error) {
        console.error('Bulk create error:', error);
        res.status(500).json({ error: 'Failed to bulk create' });
    }
});

module.exports = router;

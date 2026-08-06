const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate, isAdmin } = require('../middleware/auth');

// Get all finances (admin only)
router.get('/', authenticate, isAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        let query = `
            SELECT * FROM (
                SELECT 
                    af.id,
                    af.assignment_id,
                    af.client_paid,
                    af.writer_cost,
                    af.other_costs,
                    af.payment_status,
                    -- assignment_finances has no payment_method/payment_reference columns;
                    -- these are synthesised so the UNION shape stays consistent.
                    'manual' as payment_method,
                    CONCAT('HW-', CAST(af.assignment_id AS VARCHAR)) as payment_reference,
                    af.notes,
                    af.created_at,
                    af.updated_at,
                    a.title,
                    a.domain,
                    a.status as assignment_status,
                    u.name as writer_name,
                    a.created_at as assignment_date,
                    (af.client_paid - af.writer_cost - af.other_costs) as profit
                FROM assignment_finances af
                JOIN assignments a ON af.assignment_id = a.id
                LEFT JOIN users u ON a.writer_id = u.id AND u.role = 'writer'
                
                UNION ALL
                
                SELECT 
                    qi.id,
                    NULL as assignment_id,
                    qi.amount as client_paid,
                    0 as writer_cost,
                    0 as other_costs,
                    qi.payment_status,
                    'quickpay' as payment_method,
                    qi.invoice_number as payment_reference,
                    'QuickPay Invoice' as notes,
                    qi.created_at,
                    qi.created_at as updated_at,
                    qi.work_paid_for as title,
                    'Report/QuickPay' as domain,
                    'completed' as assignment_status,
                    'System' as writer_name,
                    qi.created_at as assignment_date,
                    qi.amount as profit
                FROM quickpay_invoices qi
                WHERE qi.payment_status = 'paid'

                UNION ALL

                -- Report checks paid for in cash count as orders/revenue in their own right.
                -- Slot-funded checks are excluded here because that money was already booked
                -- on the slot bundle row below; counting both would double-count revenue.
                SELECT
                    wr.id,
                    NULL as assignment_id,
                    COALESCE(wr.amount_charged, 0) as client_paid,
                    0 as writer_cost,
                    0 as other_costs,
                    'paid' as payment_status,
                    'report_check' as payment_method,
                    COALESCE(wr.paystack_reference, CONCAT('WNX-', CAST(wr.id AS VARCHAR))) as payment_reference,
                    CONCAT('Report check: ', wr.original_filename) as notes,
                    wr.created_at,
                    wr.created_at as updated_at,
                    wr.original_filename as title,
                    'Report Check' as domain,
                    wr.status as assignment_status,
                    'System' as writer_name,
                    wr.created_at as assignment_date,
                    COALESCE(wr.amount_charged, 0) as profit
                FROM writenix_reports wr
                WHERE wr.amount_charged IS NOT NULL AND wr.status <> 'refunded'

                UNION ALL

                SELECT
                    sp.id,
                    NULL as assignment_id,
                    sp.amount as client_paid,
                    0 as writer_cost,
                    0 as other_costs,
                    'paid' as payment_status,
                    'slot_bundle' as payment_method,
                    COALESCE(sp.paystack_reference, CONCAT('SLOT-', CAST(sp.id AS VARCHAR))) as payment_reference,
                    CONCAT(sp.slot_count, ' report slots') as notes,
                    sp.created_at,
                    sp.created_at as updated_at,
                    CONCAT(sp.slot_count, ' Report Slot Bundle') as title,
                    'Report Slots' as domain,
                    'completed' as assignment_status,
                    'System' as writer_name,
                    sp.created_at as assignment_date,
                    sp.amount as profit
                FROM slot_purchases sp
            ) combined_finances
            WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            params.push(startDate);
            query += ` AND DATE(assignment_date) >= $${params.length}`;
        }
        if (endDate) {
            params.push(endDate);
            query += ` AND DATE(assignment_date) <= $${params.length}`;
        }

        query += ` ORDER BY assignment_date DESC`;

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

        let dateFilterAf = '';
        let dateFilterQi = '';
        let dateFilterWr = '';
        let dateFilterSp = '';
        const params = [];

        if (startDate) {
            params.push(startDate);
            dateFilterAf += ` AND DATE(a.created_at) >= $${params.length}`;
            dateFilterQi += ` AND DATE(qi.created_at) >= $${params.length}`;
            dateFilterWr += ` AND DATE(wr.created_at) >= $${params.length}`;
            dateFilterSp += ` AND DATE(sp.created_at) >= $${params.length}`;
        }
        if (endDate) {
            params.push(endDate);
            dateFilterAf += ` AND DATE(a.created_at) <= $${params.length}`;
            dateFilterQi += ` AND DATE(qi.created_at) <= $${params.length}`;
            dateFilterWr += ` AND DATE(wr.created_at) <= $${params.length}`;
            dateFilterSp += ` AND DATE(sp.created_at) <= $${params.length}`;
        }

        const summaryResult = await pool.query(`
            SELECT 
                SUM(revenue) as total_revenue,
                SUM(writer_costs) as total_writer_costs,
                SUM(other_costs) as total_other_costs,
                SUM(profit) as total_profit,
                SUM(total_orders) as total_orders,
                SUM(paid_orders) as paid_orders,
                SUM(pending_orders) as pending_orders
            FROM (
                SELECT 
                    COALESCE(SUM(af.client_paid), 0) as revenue,
                    COALESCE(SUM(af.writer_cost), 0) as writer_costs,
                    COALESCE(SUM(af.other_costs), 0) as other_costs,
                    COALESCE(SUM(af.client_paid - af.writer_cost - af.other_costs), 0) as profit,
                    COUNT(*) as total_orders,
                    COUNT(CASE WHEN af.payment_status = 'paid' THEN 1 END) as paid_orders,
                    COUNT(CASE WHEN af.payment_status = 'pending' THEN 1 END) as pending_orders
                FROM assignment_finances af
                JOIN assignments a ON af.assignment_id = a.id
                WHERE 1=1 ${dateFilterAf}
                
                UNION ALL
                
                SELECT 
                    COALESCE(SUM(qi.amount), 0) as revenue,
                    0 as writer_costs,
                    0 as other_costs,
                    COALESCE(SUM(qi.amount), 0) as profit,
                    COUNT(*) as total_orders,
                    COUNT(*) as paid_orders,
                    0 as pending_orders
                FROM quickpay_invoices qi
                WHERE qi.payment_status = 'paid' ${dateFilterQi}

                UNION ALL

                -- Every report check is an order. Cash-paid ones also carry revenue;
                -- slot-funded ones are revenue-neutral here (booked on the bundle instead).
                SELECT
                    COALESCE(SUM(wr.amount_charged), 0) as revenue,
                    0 as writer_costs,
                    0 as other_costs,
                    COALESCE(SUM(wr.amount_charged), 0) as profit,
                    COUNT(*) as total_orders,
                    COUNT(*) FILTER (WHERE wr.status <> 'refunded') as paid_orders,
                    COUNT(*) FILTER (WHERE wr.status = 'processing') as pending_orders
                FROM writenix_reports wr
                WHERE wr.status <> 'refunded' ${dateFilterWr}

                UNION ALL

                SELECT
                    COALESCE(SUM(sp.amount), 0) as revenue,
                    0 as writer_costs,
                    0 as other_costs,
                    COALESCE(SUM(sp.amount), 0) as profit,
                    COUNT(*) as total_orders,
                    COUNT(*) as paid_orders,
                    0 as pending_orders
                FROM slot_purchases sp
                WHERE 1=1 ${dateFilterSp}
            ) combined
        `, params);

        // Get monthly breakdown for charts
        const monthlyResult = await pool.query(`
            SELECT month, 
                   SUM(revenue) as revenue, 
                   SUM(costs) as costs, 
                   SUM(profit) as profit 
            FROM (
                SELECT 
                    DATE_TRUNC('month', a.created_at) as month,
                    COALESCE(af.client_paid, 0) as revenue,
                    COALESCE(af.writer_cost + af.other_costs, 0) as costs,
                    COALESCE(af.client_paid - af.writer_cost - af.other_costs, 0) as profit
                FROM assignment_finances af
                JOIN assignments a ON af.assignment_id = a.id
                WHERE a.created_at >= NOW() - INTERVAL '12 months'
                
                UNION ALL
                
                SELECT 
                    DATE_TRUNC('month', qi.created_at) as month,
                    COALESCE(qi.amount, 0) as revenue,
                    0 as costs,
                    COALESCE(qi.amount, 0) as profit
                FROM quickpay_invoices qi
                WHERE qi.payment_status = 'paid' AND qi.created_at >= NOW() - INTERVAL '12 months'

                UNION ALL

                SELECT
                    DATE_TRUNC('month', wr.created_at) as month,
                    COALESCE(wr.amount_charged, 0) as revenue,
                    0 as costs,
                    COALESCE(wr.amount_charged, 0) as profit
                FROM writenix_reports wr
                WHERE wr.status <> 'refunded' AND wr.created_at >= NOW() - INTERVAL '12 months'

                UNION ALL

                SELECT
                    DATE_TRUNC('month', sp.created_at) as month,
                    COALESCE(sp.amount, 0) as revenue,
                    0 as costs,
                    COALESCE(sp.amount, 0) as profit
                FROM slot_purchases sp
                WHERE sp.created_at >= NOW() - INTERVAL '12 months'
            ) combined
            GROUP BY month
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

// Get all issued client invoices across all channels (QuickPay, Homework Panel, Turnitin)
router.get('/invoices', authenticate, isAdmin, async (req, res) => {
    try {
        const { search, status, type } = req.query;

        // 1. QuickPay Invoices
        const qp = await pool.query(`
            SELECT 
                qi.id,
                'quickpay' as type,
                'QuickPay Invoice' as type_label,
                qi.invoice_number as reference,
                qi.client_email,
                qi.client_code,
                qi.work_paid_for as description,
                qi.amount,
                qi.currency,
                qi.payment_status as status,
                qi.created_at as date,
                qi.paid_at
            FROM quickpay_invoices qi
            ORDER BY qi.created_at DESC
        `);

        // 2. Assignment / Homework Invoices
        const hw = await pool.query(`
            SELECT 
                af.id,
                'assignment' as type,
                'Homework Assignment' as type_label,
                COALESCE(co.order_number, CONCAT('HW-', CAST(a.id AS VARCHAR))) as reference,
                COALESCE(cm.email, co.guest_email) as client_email,
                qc.client_code,
                a.title as description,
                af.client_paid as amount,
                'USD' as currency,
                af.payment_status as status,
                af.created_at as date,
                af.payment_date as paid_at
            FROM assignment_finances af
            JOIN assignments a ON af.assignment_id = a.id
            LEFT JOIN client_orders co ON co.assignment_id = a.id
            LEFT JOIN client_members cm ON co.member_id = cm.id
            LEFT JOIN quickpay_clients qc ON LOWER(qc.email) = LOWER(COALESCE(cm.email, co.guest_email))
            ORDER BY af.created_at DESC
        `);

        // 3. Turnitin Check Purchases
        const wnx = await pool.query(`
            SELECT 
                wr.id,
                'plagiarism' as type,
                'Plagiarism/AI Scan' as type_label,
                CONCAT('WNX-', COALESCE(wr.writenix_reference, CAST(wr.id AS VARCHAR))) as reference,
                cm.email as client_email,
                qc.client_code,
                CONCAT('Scan: ', wr.original_filename) as description,
                COALESCE(wr.amount_charged, CASE WHEN wr.currency = 'KES' THEN 300 ELSE 8 END) as amount,
                COALESCE(wr.currency, 'USD') as currency,
                CASE WHEN wr.status = 'completed' THEN 'paid' ELSE wr.status END as status,
                wr.created_at as date,
                wr.completed_at as paid_at
            FROM writenix_reports wr
            JOIN client_members cm ON wr.member_id = cm.id
            LEFT JOIN quickpay_clients qc ON LOWER(qc.email) = LOWER(cm.email)
            ORDER BY wr.created_at DESC
        `);

        // 4. Report Slot Bundles
        const slots = await pool.query(`
            SELECT
                sp.id,
                'slots' as type,
                'Report Slot Bundle' as type_label,
                CONCAT('SLOT-', CAST(sp.id AS VARCHAR)) as reference,
                cm.email as client_email,
                qc.client_code,
                CONCAT(sp.slot_count, ' report check slots') as description,
                sp.amount,
                COALESCE(sp.currency, 'USD') as currency,
                'paid' as status,
                sp.created_at as date,
                sp.created_at as paid_at
            FROM slot_purchases sp
            LEFT JOIN client_members cm ON sp.member_id = cm.id
            LEFT JOIN quickpay_clients qc ON LOWER(qc.email) = LOWER(cm.email)
            ORDER BY sp.created_at DESC
        `);

        let invoices = [...qp.rows, ...hw.rows, ...wnx.rows, ...slots.rows];

        // Apply filters if provided
        if (search) {
            const s = search.toLowerCase();
            invoices = invoices.filter(i => 
                (i.reference && i.reference.toLowerCase().includes(s)) ||
                (i.client_email && i.client_email.toLowerCase().includes(s)) ||
                (i.client_code && i.client_code.toLowerCase().includes(s)) ||
                (i.description && i.description.toLowerCase().includes(s))
            );
        }
        if (status) {
            invoices = invoices.filter(i => i.status.toLowerCase() === status.toLowerCase());
        }
        if (type) {
            invoices = invoices.filter(i => i.type.toLowerCase() === type.toLowerCase());
        }

        // Sort descending by date
        invoices.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({ success: true, count: invoices.length, invoices });
    } catch (error) {
        console.error('Get admin invoices error:', error);
        res.status(500).json({ error: 'Failed to fetch admin invoices' });
    }
});

module.exports = router;

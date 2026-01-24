const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const jwt = require('jsonwebtoken');

// Auth middleware for admin
const authenticateAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'homework-pal-secret');
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Get weekly writer performance report
router.get('/writers/weekly', authenticateAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // Default to last 7 days
        const end = endDate ? new Date(endDate) : new Date();
        const start = startDate ? new Date(startDate) : new Date(end - 7 * 24 * 60 * 60 * 1000);

        // Get writer performance stats
        const writerStats = await pool.query(`
            SELECT 
                u.id,
                u.name,
                u.email,
                COUNT(DISTINCT a.id) as total_assignments,
                COUNT(DISTINCT CASE WHEN a.status = 'completed' THEN a.id END) as completed,
                COUNT(DISTINCT CASE WHEN a.status = 'in_progress' THEN a.id END) as in_progress,
                COUNT(DISTINCT CASE WHEN a.status = 'revision' THEN a.id END) as revisions,
                COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.amount END), 0) as total_earned,
                COALESCE(AVG(
                    CASE WHEN a.status = 'completed' AND a.completed_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (a.completed_at - a.picked_at)) / 3600 
                    END
                ), 0) as avg_completion_hours,
                COUNT(DISTINCT CASE 
                    WHEN a.completed_at > a.deadline THEN a.id 
                END) as late_deliveries
            FROM users u
            LEFT JOIN assignments a ON u.id = a.assigned_to 
                AND a.created_at BETWEEN $1 AND $2
            WHERE u.role = 'writer'
            GROUP BY u.id, u.name, u.email
            ORDER BY completed DESC, total_earned DESC
        `, [start.toISOString(), end.toISOString()]);

        // Calculate overall stats
        const overallStats = await pool.query(`
            SELECT 
                COUNT(*) as total_assignments,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
                COALESCE(SUM(amount), 0) as total_value,
                COALESCE(AVG(
                    CASE WHEN completed_at IS NOT NULL 
                    THEN EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600 
                    END
                ), 0) as avg_turnaround_hours
            FROM assignments 
            WHERE created_at BETWEEN $1 AND $2
        `, [start.toISOString(), end.toISOString()]);

        // Top performers
        const topPerformers = writerStats.rows
            .filter(w => w.completed > 0)
            .sort((a, b) => b.completed - a.completed)
            .slice(0, 5);

        res.json({
            success: true,
            report: {
                period: {
                    start: start.toISOString().split('T')[0],
                    end: end.toISOString().split('T')[0]
                },
                overall: overallStats.rows[0],
                writers: writerStats.rows,
                topPerformers,
                generatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error generating writer report:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// Get site performance report
router.get('/site/weekly', authenticateAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        const end = endDate ? new Date(endDate) : new Date();
        const start = startDate ? new Date(startDate) : new Date(end - 7 * 24 * 60 * 60 * 1000);
        const prevStart = new Date(start - 7 * 24 * 60 * 60 * 1000);

        // Current period stats
        const currentStats = await pool.query(`
            SELECT 
                COUNT(*) as total_orders,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
                COUNT(CASE WHEN client_source = 'client_portal' THEN 1 END) as client_portal_orders,
                COALESCE(SUM(amount), 0) as total_revenue,
                COALESCE(AVG(amount), 0) as avg_order_value
            FROM assignments 
            WHERE created_at BETWEEN $1 AND $2
        `, [start.toISOString(), end.toISOString()]);

        // Previous period for comparison
        const prevStats = await pool.query(`
            SELECT 
                COUNT(*) as total_orders,
                COALESCE(SUM(amount), 0) as total_revenue
            FROM assignments 
            WHERE created_at BETWEEN $1 AND $2
        `, [prevStart.toISOString(), start.toISOString()]);

        // Orders by domain
        const byDomain = await pool.query(`
            SELECT domain, COUNT(*) as count, COALESCE(SUM(amount), 0) as revenue
            FROM assignments 
            WHERE created_at BETWEEN $1 AND $2
            GROUP BY domain
            ORDER BY count DESC
        `, [start.toISOString(), end.toISOString()]);

        // Daily breakdown
        const dailyStats = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as orders,
                COALESCE(SUM(amount), 0) as revenue
            FROM assignments 
            WHERE created_at BETWEEN $1 AND $2
            GROUP BY DATE(created_at)
            ORDER BY date
        `, [start.toISOString(), end.toISOString()]);

        // Membership stats
        const membershipStats = await pool.query(`
            SELECT 
                COUNT(*) as total_members,
                COUNT(CASE WHEN is_verified THEN 1 END) as verified_members,
                COUNT(CASE WHEN created_at BETWEEN $1 AND $2 THEN 1 END) as new_members
            FROM client_members
        `, [start.toISOString(), end.toISOString()]);

        // Inquiry stats
        let inquiryStats = { total: 0, resolved: 0, avg_resolution_hours: 0 };
        try {
            const inqResult = await pool.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'closed' THEN 1 END) as resolved,
                    COALESCE(AVG(
                        CASE WHEN closed_at IS NOT NULL 
                        THEN EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600 
                        END
                    ), 0) as avg_resolution_hours
                FROM client_inquiries 
                WHERE created_at BETWEEN $1 AND $2
            `, [start.toISOString(), end.toISOString()]);
            inquiryStats = inqResult.rows[0];
        } catch (e) {
            // Table might not exist yet
        }

        // Calculate growth
        const current = currentStats.rows[0];
        const prev = prevStats.rows[0];
        const orderGrowth = prev.total_orders > 0 
            ? ((current.total_orders - prev.total_orders) / prev.total_orders * 100).toFixed(1)
            : 0;
        const revenueGrowth = prev.total_revenue > 0
            ? ((current.total_revenue - prev.total_revenue) / prev.total_revenue * 100).toFixed(1)
            : 0;

        res.json({
            success: true,
            report: {
                period: {
                    start: start.toISOString().split('T')[0],
                    end: end.toISOString().split('T')[0]
                },
                summary: {
                    ...current,
                    orderGrowth: parseFloat(orderGrowth),
                    revenueGrowth: parseFloat(revenueGrowth)
                },
                byDomain: byDomain.rows,
                dailyStats: dailyStats.rows,
                membership: membershipStats.rows[0],
                inquiries: inquiryStats,
                generatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error generating site report:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// Generate PDF report
router.get('/download/:type', authenticateAdmin, async (req, res) => {
    try {
        const { type } = req.params;
        const { startDate, endDate } = req.query;
        
        const end = endDate ? new Date(endDate) : new Date();
        const start = startDate ? new Date(startDate) : new Date(end - 7 * 24 * 60 * 60 * 1000);

        let reportData;
        let title;

        if (type === 'writers') {
            const response = await fetch(`${req.protocol}://${req.get('host')}/api/reports/writers/weekly?startDate=${start.toISOString()}&endDate=${end.toISOString()}`, {
                headers: { 'Authorization': req.headers.authorization }
            });
            reportData = await response.json();
            title = 'Writer Performance Report';
        } else if (type === 'site') {
            const response = await fetch(`${req.protocol}://${req.get('host')}/api/reports/site/weekly?startDate=${start.toISOString()}&endDate=${end.toISOString()}`, {
                headers: { 'Authorization': req.headers.authorization }
            });
            reportData = await response.json();
            title = 'Site Performance Report';
        } else {
            return res.status(400).json({ error: 'Invalid report type' });
        }

        // Generate HTML for PDF
        const html = generateReportHTML(type, reportData.report, title);
        
        // For now, return HTML (can be converted to PDF on client side or use puppeteer)
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="${type}-report-${start.toISOString().split('T')[0]}.html"`);
        res.send(html);

    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

// Generate HTML report for PDF
function generateReportHTML(type, data, title) {
    const period = `${data.period.start} to ${data.period.end}`;
    
    let content = '';
    
    if (type === 'writers') {
        content = `
            <h2>Overall Statistics</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${data.overall.total_assignments}</div>
                    <div class="stat-label">Total Assignments</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.overall.completed}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">$${parseFloat(data.overall.total_value).toFixed(2)}</div>
                    <div class="stat-label">Total Value</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${parseFloat(data.overall.avg_turnaround_hours).toFixed(1)}h</div>
                    <div class="stat-label">Avg Turnaround</div>
                </div>
            </div>

            <h2>Top Performers</h2>
            <table>
                <tr><th>Rank</th><th>Writer</th><th>Completed</th><th>Earned</th></tr>
                ${data.topPerformers.map((w, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${w.name}</td>
                        <td>${w.completed}</td>
                        <td>$${parseFloat(w.total_earned).toFixed(2)}</td>
                    </tr>
                `).join('')}
            </table>

            <h2>All Writers Performance</h2>
            <table>
                <tr><th>Writer</th><th>Total</th><th>Completed</th><th>In Progress</th><th>Revisions</th><th>Late</th><th>Earned</th></tr>
                ${data.writers.map(w => `
                    <tr>
                        <td>${w.name}</td>
                        <td>${w.total_assignments}</td>
                        <td>${w.completed}</td>
                        <td>${w.in_progress}</td>
                        <td>${w.revisions}</td>
                        <td>${w.late_deliveries}</td>
                        <td>$${parseFloat(w.total_earned).toFixed(2)}</td>
                    </tr>
                `).join('')}
            </table>
        `;
    } else if (type === 'site') {
        content = `
            <h2>Summary</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${data.summary.total_orders}</div>
                    <div class="stat-label">Total Orders</div>
                    <div class="stat-change ${data.summary.orderGrowth >= 0 ? 'positive' : 'negative'}">
                        ${data.summary.orderGrowth >= 0 ? '+' : ''}${data.summary.orderGrowth}%
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.summary.completed_orders}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">$${parseFloat(data.summary.total_revenue).toFixed(2)}</div>
                    <div class="stat-label">Revenue</div>
                    <div class="stat-change ${data.summary.revenueGrowth >= 0 ? 'positive' : 'negative'}">
                        ${data.summary.revenueGrowth >= 0 ? '+' : ''}${data.summary.revenueGrowth}%
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">$${parseFloat(data.summary.avg_order_value).toFixed(2)}</div>
                    <div class="stat-label">Avg Order Value</div>
                </div>
            </div>

            <h2>Orders by Domain</h2>
            <table>
                <tr><th>Domain</th><th>Orders</th><th>Revenue</th></tr>
                ${data.byDomain.map(d => `
                    <tr>
                        <td>${d.domain}</td>
                        <td>${d.count}</td>
                        <td>$${parseFloat(d.revenue).toFixed(2)}</td>
                    </tr>
                `).join('')}
            </table>

            <h2>Membership</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${data.membership.total_members}</div>
                    <div class="stat-label">Total Members</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.membership.verified_members}</div>
                    <div class="stat-label">Verified</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.membership.new_members}</div>
                    <div class="stat-label">New This Period</div>
                </div>
            </div>

            <h2>Inquiries</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${data.inquiries.total}</div>
                    <div class="stat-label">Total Inquiries</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.inquiries.resolved}</div>
                    <div class="stat-label">Resolved</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${parseFloat(data.inquiries.avg_resolution_hours).toFixed(1)}h</div>
                    <div class="stat-label">Avg Resolution Time</div>
                </div>
            </div>
        `;
    }

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; color: #1e293b; }
        .header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #6366f1; padding-bottom: 20px; }
        .logo { font-size: 32px; font-weight: bold; color: #6366f1; }
        .logo span { color: #fbbf24; }
        h1 { margin: 10px 0 5px; }
        .period { color: #64748b; }
        h2 { color: #334155; margin-top: 30px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
        .stat-card { background: #f8fafc; border-radius: 8px; padding: 20px; text-align: center; }
        .stat-value { font-size: 28px; font-weight: bold; color: #6366f1; }
        .stat-label { color: #64748b; margin-top: 5px; }
        .stat-change { font-size: 14px; margin-top: 5px; }
        .stat-change.positive { color: #22c55e; }
        .stat-change.negative { color: #ef4444; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f8fafc; font-weight: 600; }
        tr:hover { background: #f8fafc; }
        .footer { margin-top: 40px; text-align: center; color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 20px; }
        @media print {
            body { margin: 20px; }
            .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">Homework<span>Pal</span></div>
        <h1>${title}</h1>
        <div class="period">${period}</div>
    </div>
    
    ${content}
    
    <div class="footer">
        <p>Generated on ${new Date().toLocaleString()} | HomeworkPal Management System</p>
    </div>
</body>
</html>
    `;
}

module.exports = router;

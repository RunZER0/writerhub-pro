const express = require('express');
const db = require('../db');
const { authenticate, isAdmin } = require('../middleware/auth');
const { sendPushToUser, sendPushToRole, sendPushToDomain } = require('./push');
const { sendTelegramToUser, sendTelegramToDomain } = require('./telegram');

const router = express.Router();

// Get all assignments
router.get('/', authenticate, async (req, res) => {
    try {
        let query;
        let params = [];

        if (req.user.role === 'admin') {
            // Admin sees all assignments
            query = `
                SELECT a.*, u.name as writer_name, u.email as writer_email, u.is_online as writer_online
                FROM assignments a
                LEFT JOIN users u ON a.writer_id = u.id
                ORDER BY 
                    CASE WHEN a.submitted_amount IS NOT NULL AND a.amount_approved = FALSE THEN 0 ELSE 1 END,
                    a.deadline ASC, a.created_at DESC
            `;
        } else {
            // Writers see only their picked assignments
            query = `
                SELECT a.*, u.name as writer_name, u.email as writer_email
                FROM assignments a
                LEFT JOIN users u ON a.writer_id = u.id
                WHERE a.writer_id = $1
                ORDER BY a.deadline ASC, a.created_at DESC
            `;
            params = [req.user.id];
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ error: 'Failed to get assignments' });
    }
});

// Get job board - available jobs for writers to pick
router.get('/job-board', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'writer') {
            return res.status(403).json({ error: 'Only writers can access job board' });
        }

        // Get writer's domains
        const writerResult = await db.query('SELECT domains FROM users WHERE id = $1', [req.user.id]);
        const writerDomains = writerResult.rows[0]?.domains?.split(',').map(d => d.trim()).filter(d => d) || [];

        // Get available jobs in writer's domains that they're not ineligible for
        const result = await db.query(`
            SELECT a.*, 
                   (SELECT COUNT(*) FROM files WHERE assignment_id = a.id AND upload_type = 'instructions') as has_instructions
            FROM assignments a
            WHERE a.writer_id IS NULL 
              AND a.status = 'pending'
              AND (a.domain = '' OR a.domain IS NULL OR a.domain = ANY($1::text[]))
              AND NOT ($2 = ANY(COALESCE(a.ineligible_writers, ARRAY[]::integer[])))
            ORDER BY a.deadline ASC, a.created_at DESC
        `, [writerDomains.length > 0 ? writerDomains : [''], req.user.id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get job board error:', error);
        res.status(500).json({ error: 'Failed to get job board' });
    }
});

// Pick a job from the job board
router.post('/:id/pick', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'writer') {
            return res.status(403).json({ error: 'Only writers can pick jobs' });
        }

        const { writer_deadline } = req.body;

        if (!writer_deadline) {
            return res.status(400).json({ error: 'You must set a delivery deadline' });
        }

        // Get the assignment
        const current = await db.query('SELECT * FROM assignments WHERE id = $1', [req.params.id]);
        
        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const assignment = current.rows[0];

        // Check if already picked
        if (assignment.writer_id) {
            return res.status(400).json({ error: 'This job has already been picked by another writer' });
        }

        // Check if writer is ineligible
        if (assignment.ineligible_writers && assignment.ineligible_writers.includes(req.user.id)) {
            return res.status(403).json({ error: 'You are ineligible to pick this job' });
        }

        // Validate writer's deadline - must be at least 30 min before admin's deadline
        const adminDeadline = new Date(assignment.deadline);
        const writerDeadlineDate = new Date(writer_deadline);
        const minDeadline = new Date(adminDeadline.getTime() - 30 * 60 * 1000); // 30 min before

        if (writerDeadlineDate > minDeadline) {
            return res.status(400).json({ 
                error: 'Your delivery deadline must be at least 30 minutes before the client deadline' 
            });
        }

        if (writerDeadlineDate < new Date()) {
            return res.status(400).json({ error: 'Delivery deadline must be in the future' });
        }

        // Get writer's rate
        const writerResult = await db.query('SELECT rate_per_word FROM users WHERE id = $1', [req.user.id]);
        const writerRate = writerResult.rows[0]?.rate_per_word || assignment.rate;
        const amount = assignment.word_count * writerRate;

        // Pick the job
        const result = await db.query(`
            UPDATE assignments SET
                writer_id = $1,
                picked_at = CURRENT_TIMESTAMP,
                writer_deadline = $2,
                status = 'in_progress',
                rate = $3,
                amount = $4,
                updated_at = NOW()
            WHERE id = $5 AND writer_id IS NULL
            RETURNING *
        `, [req.user.id, writer_deadline, writerRate, amount, req.params.id]);

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Job was picked by another writer' });
        }

        // Notify admin
        const admins = await db.query("SELECT id FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
            await db.query(`
                INSERT INTO notifications (user_id, title, message, type, link)
                VALUES ($1, $2, $3, $4, $5)
            `, [admin.id, 'Job Picked', `A writer picked: ${assignment.title}`, 'info', '/assignments']);
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Pick job error:', error);
        res.status(500).json({ error: 'Failed to pick job' });
    }
});

// Request time extension
router.post('/:id/extension', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'writer') {
            return res.status(403).json({ error: 'Only writers can request extensions' });
        }

        const { requested_deadline, reason } = req.body;

        if (!requested_deadline || !reason) {
            return res.status(400).json({ error: 'Please provide new deadline and reason' });
        }

        // Get the assignment
        const current = await db.query('SELECT * FROM assignments WHERE id = $1', [req.params.id]);
        
        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const assignment = current.rows[0];

        if (assignment.writer_id !== req.user.id) {
            return res.status(403).json({ error: 'This is not your assignment' });
        }

        // Validate new deadline - must be before admin deadline
        const adminDeadline = new Date(assignment.deadline);
        const newDeadline = new Date(requested_deadline);
        const minDeadline = new Date(adminDeadline.getTime() - 30 * 60 * 1000);

        if (newDeadline > minDeadline) {
            return res.status(400).json({ 
                error: 'Extended deadline must still be at least 30 minutes before the client deadline' 
            });
        }

        // Create extension request
        const result = await db.query(`
            INSERT INTO extension_requests (assignment_id, writer_id, requested_deadline, reason)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [req.params.id, req.user.id, requested_deadline, reason]);

        // Mark assignment as having pending extension
        await db.query(`
            UPDATE assignments SET extension_requested = TRUE, extension_reason = $1
            WHERE id = $2
        `, [reason, req.params.id]);

        // Notify admin
        const admins = await db.query("SELECT id FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
            await db.query(`
                INSERT INTO notifications (user_id, title, message, type, link)
                VALUES ($1, $2, $3, $4, $5)
            `, [admin.id, 'Extension Request', `Extension requested for: ${assignment.title}`, 'warning', '/assignments']);
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Request extension error:', error);
        res.status(500).json({ error: 'Failed to request extension' });
    }
});

// Respond to extension request (Admin only)
router.post('/extension/:id/respond', authenticate, isAdmin, async (req, res) => {
    try {
        const { status, admin_response } = req.body;

        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Status must be approved or rejected' });
        }

        // Get extension request
        const extResult = await db.query('SELECT * FROM extension_requests WHERE id = $1', [req.params.id]);
        
        if (extResult.rows.length === 0) {
            return res.status(404).json({ error: 'Extension request not found' });
        }

        const extension = extResult.rows[0];

        // Update extension request
        await db.query(`
            UPDATE extension_requests SET
                status = $1,
                admin_response = $2,
                responded_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [status, admin_response, req.params.id]);

        // If approved, update assignment deadline
        if (status === 'approved') {
            await db.query(`
                UPDATE assignments SET
                    writer_deadline = $1,
                    extension_requested = FALSE,
                    extension_reason = NULL,
                    updated_at = NOW()
                WHERE id = $2
            `, [extension.requested_deadline, extension.assignment_id]);
        } else {
            await db.query(`
                UPDATE assignments SET
                    extension_requested = FALSE,
                    extension_reason = NULL,
                    updated_at = NOW()
                WHERE id = $1
            `, [extension.assignment_id]);
        }

        // Notify writer
        await db.query(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES ($1, $2, $3, $4)
        `, [
            extension.writer_id, 
            status === 'approved' ? 'Extension Approved' : 'Extension Rejected',
            status === 'approved' 
                ? 'Your extension request was approved' 
                : `Extension rejected: ${admin_response || 'No reason given'}`,
            status === 'approved' ? 'success' : 'error'
        ]);

        res.json({ message: `Extension ${status}` });
    } catch (error) {
        console.error('Respond to extension error:', error);
        res.status(500).json({ error: 'Failed to respond to extension' });
    }
});

// Get pending extension requests (Admin only)
router.get('/extensions/pending', authenticate, isAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT er.*, a.title as assignment_title, u.name as writer_name
            FROM extension_requests er
            JOIN assignments a ON er.assignment_id = a.id
            JOIN users u ON er.writer_id = u.id
            WHERE er.status = 'pending'
            ORDER BY er.created_at ASC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Get extensions error:', error);
        res.status(500).json({ error: 'Failed to get extension requests' });
    }
});

// Admin override writer deadline
router.post('/:id/override-deadline', authenticate, isAdmin, async (req, res) => {
    try {
        const { new_deadline } = req.body;

        if (!new_deadline) {
            return res.status(400).json({ error: 'Please provide new deadline' });
        }

        const result = await db.query(`
            UPDATE assignments SET
                writer_deadline = $1,
                updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `, [new_deadline, req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        // Notify writer
        if (result.rows[0].writer_id) {
            await db.query(`
                INSERT INTO notifications (user_id, title, message, type)
            VALUES ($1, $2, $3, $4)
            `, [result.rows[0].writer_id, 'Deadline Updated', `Admin has updated your deadline for: ${result.rows[0].title}`, 'warning']);
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Override deadline error:', error);
        res.status(500).json({ error: 'Failed to override deadline' });
    }
});

// Check for overdue assignments and auto-reopen (to be called periodically)
router.post('/check-overdue', authenticate, isAdmin, async (req, res) => {
    try {
        // Find assignments past writer deadline that haven't been delivered
        const overdue = await db.query(`
            SELECT * FROM assignments
            WHERE writer_id IS NOT NULL
              AND writer_deadline < CURRENT_TIMESTAMP
              AND status IN ('pending', 'in_progress')
              AND deadline > CURRENT_TIMESTAMP
        `);

        const reopened = [];

        for (const assignment of overdue.rows) {
            // Add current writer to ineligible list
            const ineligible = assignment.ineligible_writers || [];
            ineligible.push(assignment.writer_id);

            // Reopen the job
            await db.query(`
                UPDATE assignments SET
                    writer_id = NULL,
                    picked_at = NULL,
                    writer_deadline = NULL,
                    status = 'pending',
                    ineligible_writers = $1,
                    extension_requested = FALSE,
                    extension_reason = NULL,
                    updated_at = NOW()
                WHERE id = $2
            `, [ineligible, assignment.id]);

            // Notify the writer they lost the job
            await db.query(`
                INSERT INTO notifications (user_id, title, message, type)
                VALUES ($1, $2, $3, $4)
            `, [
                assignment.writer_id, 
                'Job Auto-Reopened', 
                `You missed the deadline for "${assignment.title}". The job has been reopened and you cannot pick it again.`,
                'error'
            ]);

            reopened.push(assignment.id);
        }

        res.json({ reopened_count: reopened.length, reopened_ids: reopened });
    } catch (error) {
        console.error('Check overdue error:', error);
        res.status(500).json({ error: 'Failed to check overdue assignments' });
    }
});

// Get single assignment
router.get('/:id', authenticate, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT a.*, u.name as writer_name, u.email as writer_email, u.is_online as writer_online, u.last_seen as writer_last_seen
            FROM assignments a
            LEFT JOIN users u ON a.writer_id = u.id
            WHERE a.id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const assignment = result.rows[0];

        // Writers can only view their own assignments or available jobs
        if (req.user.role !== 'admin' && assignment.writer_id !== req.user.id && assignment.writer_id !== null) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(assignment);
    } catch (error) {
        console.error('Get assignment error:', error);
        res.status(500).json({ error: 'Failed to get assignment' });
    }
});

// Create assignment (Admin only)
router.post('/', authenticate, isAdmin, async (req, res) => {
    try {
        const { title, description, word_count, word_count_min, word_count_max, amount, deadline, domain, links } = req.body;

        if (!title || !deadline) {
            return res.status(400).json({ error: 'Title and deadline are required' });
        }

        const finalWordCountMin = word_count_min || word_count || 0;
        const finalWordCountMax = word_count_max || word_count || finalWordCountMin;
        const finalAmount = amount || 0;

        // Create assignment (unassigned - goes to job board)
        const result = await db.query(`
            INSERT INTO assignments (title, description, word_count, word_count_min, word_count_max, rate, amount, deadline, domain, links, status, ineligible_writers)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', '{}')
            RETURNING *
        `, [title, description || null, finalWordCountMax, finalWordCountMin, finalWordCountMax, 0, finalAmount, deadline, domain || '', links || null]);

        const assignment = result.rows[0];

        // Notify writers in this domain about new job
        if (domain) {
            const domainWriters = await db.query(`
                SELECT id FROM users 
                WHERE role = 'writer' AND status = 'active' AND domains LIKE $1
            `, [`%${domain}%`]);

            for (const writer of domainWriters.rows) {
                await db.query(`
                    INSERT INTO notifications (user_id, title, message, type, link)
                    VALUES ($1, $2, $3, $4, $5)
                `, [writer.id, 'New Job Available', `New ${domain} job posted: ${title}`, 'assignment', '/job-board']);
            }
            // Send push notification to domain writers
            sendPushToDomain(domain, '🆕 New Job Available', `${domain} job: ${title}`, '/job-board');
            // Send Telegram notification to domain writers
            sendTelegramToDomain(domain, `🆕 <b>New Job Available!</b>\n\n📋 ${title}\n🏷️ Domain: ${domain}\n\nOpen WriterHub Pro to pick this job.`);
        } else {
            // Notify all active writers
            const allWriters = await db.query(`
                SELECT id FROM users WHERE role = 'writer' AND status = 'active'
            `);

            for (const writer of allWriters.rows) {
                await db.query(`
                    INSERT INTO notifications (user_id, title, message, type, link)
                    VALUES ($1, $2, $3, $4, $5)
                `, [writer.id, 'New Job Available', `New job posted: ${title}`, 'assignment', '/job-board']);
            }
            // Send push notification to all writers
            sendPushToDomain(null, '🆕 New Job Available', title, '/job-board');
            // Send Telegram notification to all writers
            sendTelegramToDomain(null, `🆕 <b>New Job Available!</b>\n\n📋 ${title}\n\nOpen WriterHub Pro to pick this job.`);
        }

        res.status(201).json(assignment);
    } catch (error) {
        console.error('Create assignment error:', error);
        res.status(500).json({ error: 'Failed to create assignment' });
    }
});

// Update assignment
router.put('/:id', authenticate, async (req, res) => {
    try {
        const { title, description, word_count, word_count_min, word_count_max, rate, amount, deadline, status, payment_status, domain, links, submitted_amount, amount_approved } = req.body;

        // Get current assignment
        const current = await db.query('SELECT * FROM assignments WHERE id = $1', [req.params.id]);
        
        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const currentAssignment = current.rows[0];

        // Writers can only update status and submitted_amount on their own assignments
        if (req.user.role !== 'admin') {
            if (currentAssignment.writer_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
            
            // Writers can only change status and submit their proposed amount
            if (title || description || word_count || word_count_min || word_count_max || rate || amount || deadline || payment_status || domain || links || amount_approved !== undefined) {
                return res.status(403).json({ error: 'Writers can only update status and submit proposed amount' });
            }
            
            // If writer is submitting amount or updating status
            if (submitted_amount !== undefined || status) {
                const writerResult = await db.query(`
                    UPDATE assignments SET
                        status = COALESCE($1, status),
                        submitted_amount = COALESCE($2, submitted_amount),
                        updated_at = NOW()
                    WHERE id = $3
                    RETURNING *
                `, [status, submitted_amount, req.params.id]);

                const updatedAssignment = writerResult.rows[0];

                // Notify admin if price was submitted
                if (submitted_amount) {
                    const admins = await db.query("SELECT id FROM users WHERE role = 'admin'");
                    for (const admin of admins.rows) {
                        await db.query(`
                            INSERT INTO notifications (user_id, title, message, type, link)
                            VALUES ($1, $2, $3, $4, $5)
                        `, [admin.id, 'Price Approval Needed', `Writer submitted $${submitted_amount} for: ${updatedAssignment.title}`, 'approval', `/assignments`]);
                    }
                }

                // Notify admin if status changed to completed (submitted)
                if (status === 'completed') {
                    const admins = await db.query("SELECT id FROM users WHERE role = 'admin'");
                    for (const admin of admins.rows) {
                        await db.query(`
                            INSERT INTO notifications (user_id, title, message, type, link)
                            VALUES ($1, $2, $3, $4, $5)
                        `, [admin.id, 'Work Submitted', `Writer marked "${updatedAssignment.title}" as completed`, 'success', `/assignments`]);
                    }
                }

                return res.json(updatedAssignment);
            }
        }

        // Admin update logic - use amount directly, no auto-calculation
        let newAmount = amount !== undefined ? amount : currentAssignment.amount;

        // If admin is approving a submitted amount, use that
        if (amount_approved && currentAssignment.submitted_amount) {
            newAmount = parseFloat(currentAssignment.submitted_amount);
        }

        const result = await db.query(`
            UPDATE assignments SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                word_count = COALESCE($3, word_count),
                word_count_min = COALESCE($4, word_count_min),
                word_count_max = COALESCE($5, word_count_max),
                rate = COALESCE($6, rate),
                amount = $7,
                deadline = COALESCE($8, deadline),
                status = COALESCE($9, status),
                payment_status = COALESCE($10, payment_status),
                domain = COALESCE($11, domain),
                links = COALESCE($12, links),
                amount_approved = COALESCE($13, amount_approved),
                submitted_amount = CASE WHEN $13 = TRUE THEN NULL ELSE submitted_amount END,
                updated_at = NOW()
            WHERE id = $14
            RETURNING *
        `, [title, description, word_count || word_count_max, word_count_min, word_count_max, rate, newAmount, deadline, status, payment_status, domain, links, amount_approved, req.params.id]);

        const assignment = result.rows[0];

        // Notify writer if amount was approved
        if (amount_approved && currentAssignment.writer_id) {
            await db.query(`
                INSERT INTO notifications (user_id, title, message, type)
                VALUES ($1, $2, $3, $4)
            `, [currentAssignment.writer_id, 'Amount Approved', `Your submitted amount of $${currentAssignment.submitted_amount} for "${assignment.title}" has been approved.`, 'success']);
        }

        res.json(assignment);
    } catch (error) {
        console.error('Update assignment error:', error);
        res.status(500).json({ error: 'Failed to update assignment' });
    }
});

// Delete assignment (Admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res) => {
    try {
        const result = await db.query(
            'DELETE FROM assignments WHERE id = $1 RETURNING id',
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        res.json({ message: 'Assignment deleted successfully' });
    } catch (error) {
        console.error('Delete assignment error:', error);
        res.status(500).json({ error: 'Failed to delete assignment' });
    }
});

module.exports = router;

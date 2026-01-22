const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, isAdmin } = require('../middleware/auth');
const { sendEmail, emailTemplates } = require('../utils/email');

const router = express.Router();

// Generate random password
const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 10; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
};

// Get all writers (Admin only)
router.get('/', authenticate, isAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT u.id, u.email, u.name, u.phone, u.rate_per_word, u.status, u.notes, u.domains, u.created_at,
                   COUNT(a.id) as assignment_count,
                   COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.amount ELSE 0 END), 0) as total_earned,
                   COALESCE((SELECT SUM(amount) FROM payments WHERE writer_id = u.id), 0) as total_paid
            FROM users u
            LEFT JOIN assignments a ON a.writer_id = u.id
            WHERE u.role = 'writer'
            GROUP BY u.id
            ORDER BY u.name ASC
        `);

        // Calculate balance owed
        const writers = result.rows.map(w => ({
            ...w,
            total_owed: parseFloat(w.total_earned) - parseFloat(w.total_paid)
        }));

        res.json(writers);
    } catch (error) {
        console.error('Get writers error:', error);
        res.status(500).json({ error: 'Failed to get writers' });
    }
});

// Get single writer
router.get('/:id', authenticate, async (req, res) => {
    try {
        // Writers can only view themselves
        if (req.user.role !== 'admin' && req.user.id !== parseInt(req.params.id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = await db.query(`
            SELECT u.id, u.email, u.name, u.phone, u.rate_per_word, u.status, u.notes, u.domains, u.created_at,
                   COUNT(a.id) as assignment_count,
                   COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.amount ELSE 0 END), 0) as total_earned,
                   COALESCE((SELECT SUM(amount) FROM payments WHERE writer_id = u.id), 0) as total_paid
            FROM users u
            LEFT JOIN assignments a ON a.writer_id = u.id
            WHERE u.id = $1 AND u.role = 'writer'
            GROUP BY u.id
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Writer not found' });
        }

        const writer = result.rows[0];
        writer.total_owed = parseFloat(writer.total_earned) - parseFloat(writer.total_paid);

        res.json(writer);
    } catch (error) {
        console.error('Get writer error:', error);
        res.status(500).json({ error: 'Failed to get writer' });
    }
});

// Create writer (Admin only)
router.post('/', authenticate, isAdmin, async (req, res) => {
    try {
        const { email, name, phone, rate_per_word, status, notes, domains } = req.body;

        if (!email || !name) {
            return res.status(400).json({ error: 'Email and name are required' });
        }

        // Check if email exists
        const existing = await db.query(
            'SELECT id FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        // Generate temporary password
        const tempPassword = generatePassword();
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        // Create writer with must_change_password flag
        const result = await db.query(`
            INSERT INTO users (email, password, name, phone, rate_per_word, status, notes, domains, role, must_change_password)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'writer', TRUE)
            RETURNING id, email, name, phone, rate_per_word, status, notes, domains, created_at
        `, [email.toLowerCase(), hashedPassword, name, phone || null, rate_per_word || 0.01, status || 'active', notes || null, domains || '']);

        const writer = result.rows[0];

        // Note: Email disabled on Render free tier - admin shares credentials manually
        // const emailContent = emailTemplates.welcomeWriter(name, email, tempPassword);
        // sendEmail(email, emailContent.subject, emailContent.html);

        // Return password to admin so they can share it manually
        res.status(201).json({
            ...writer,
            generated_password: tempPassword,
            message: 'Writer created. Share the login credentials below with them.'
        });
    } catch (error) {
        console.error('Create writer error:', error);
        res.status(500).json({ error: 'Failed to create writer' });
    }
});

// Update writer (Admin only)
router.put('/:id', authenticate, isAdmin, async (req, res) => {
    try {
        const { name, phone, rate_per_word, status, notes, domains } = req.body;

        const result = await db.query(`
            UPDATE users 
            SET name = COALESCE($1, name),
                phone = COALESCE($2, phone),
                rate_per_word = COALESCE($3, rate_per_word),
                status = COALESCE($4, status),
                notes = COALESCE($5, notes),
                domains = COALESCE($6, domains),
                updated_at = NOW()
            WHERE id = $7 AND role = 'writer'
            RETURNING id, email, name, phone, rate_per_word, status, notes, domains, updated_at
        `, [name, phone, rate_per_word, status, notes, domains, req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Writer not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update writer error:', error);
        res.status(500).json({ error: 'Failed to update writer' });
    }
});

// Delete writer (Admin only)
router.delete('/:id', authenticate, isAdmin, async (req, res) => {
    try {
        // Check if writer has assignments
        const assignments = await db.query(
            'SELECT COUNT(*) FROM assignments WHERE writer_id = $1',
            [req.params.id]
        );

        if (parseInt(assignments.rows[0].count) > 0) {
            // Unassign instead of blocking
            await db.query(
                'UPDATE assignments SET writer_id = NULL WHERE writer_id = $1',
                [req.params.id]
            );
        }

        const result = await db.query(
            'DELETE FROM users WHERE id = $1 AND role = $2 RETURNING id',
            [req.params.id, 'writer']
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Writer not found' });
        }

        res.json({ message: 'Writer deleted successfully' });
    } catch (error) {
        console.error('Delete writer error:', error);
        res.status(500).json({ error: 'Failed to delete writer' });
    }
});

// Reset writer password (Admin only)
router.post('/:id/reset-password', authenticate, isAdmin, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT email, name FROM users WHERE id = $1 AND role = $2',
            [req.params.id, 'writer']
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Writer not found' });
        }

        const writer = result.rows[0];
        const tempPassword = generatePassword();
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        await db.query(
            'UPDATE users SET password = $1, must_change_password = TRUE, updated_at = NOW() WHERE id = $2',
            [hashedPassword, req.params.id]
        );

        // Note: Email disabled on Render free tier - admin shares credentials manually
        // const emailContent = emailTemplates.welcomeWriter(writer.name, writer.email, tempPassword);
        // sendEmail(writer.email, 'Password Reset - WriterHub Pro', emailContent.html);

        // Create notification for writer
        await db.query(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES ($1, $2, $3, $4)
        `, [req.params.id, 'Password Reset', 'Your password has been reset by admin. Please change it after logging in.', 'info']);

        // Return new password to admin
        res.json({ 
            message: 'Password reset successfully.',
            new_password: tempPassword,
            email: writer.email,
            name: writer.name
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

module.exports = router;

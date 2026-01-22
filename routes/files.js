const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const { sendPushToUser, sendPushToRole } = require('./push');
const { sendTelegramToUser, sendTelegramToRole } = require('./telegram');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const subDir = req.body.upload_type === 'instructions' ? 'instructions' : 'submissions';
        const dir = path.join(uploadsDir, subDir);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
    }
});

// File filter - allow docs, pdfs, images
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'image/jpeg',
        'image/png',
        'image/gif'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, TXT, JPG, PNG, GIF'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Upload file for an assignment
router.post('/:assignmentId', authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { assignmentId } = req.params;
        const { upload_type } = req.body;

        // Validate upload_type
        if (!['instructions', 'submission'].includes(upload_type)) {
            return res.status(400).json({ error: 'Invalid upload type' });
        }

        // Only admin can upload instructions
        if (upload_type === 'instructions' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admin can upload instructions' });
        }

        // Check assignment exists
        const assignment = await pool.query('SELECT * FROM assignments WHERE id = $1', [assignmentId]);
        if (assignment.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        // For submissions, only assigned writer can upload
        if (upload_type === 'submission') {
            const a = assignment.rows[0];
            if (req.user.role === 'writer' && a.writer_id !== req.user.id) {
                return res.status(403).json({ error: 'You are not assigned to this job' });
            }
        }

        // Save file info to database
        const result = await pool.query(`
            INSERT INTO files (assignment_id, uploaded_by, filename, original_name, file_type, file_size, file_path, upload_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            assignmentId,
            req.user.id,
            req.file.filename,
            req.file.originalname,
            req.file.mimetype,
            req.file.size,
            req.file.path,
            upload_type
        ]);

        // Create notification
        if (upload_type === 'submission') {
            // Notify admin of submission
            const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
            for (const admin of admins.rows) {
                await pool.query(`
                    INSERT INTO notifications (user_id, title, message, type, link)
                    VALUES ($1, $2, $3, $4, $5)
                `, [
                    admin.id,
                    'Work Submitted',
                    `Writer has submitted work for "${assignment.rows[0].title}"`,
                    'info',
                    `/assignments/${assignmentId}`
                ]);
            }
            // Send push and Telegram to all admins
            sendPushToRole('admin', '📤 Work Submitted', `New submission for "${assignment.rows[0].title}"`, '/assignments');
            sendTelegramToRole('admin', 
                `📤 <b>Work Submitted</b>\n\n` +
                `📋 Job: ${assignment.rows[0].title}\n` +
                `👤 Writer: ${req.user.name}\n` +
                `📎 File: ${req.file.originalname}\n\n` +
                `Review the submission in HomeworkHub.`
            );
        } else {
            // Notify writer of new instructions
            if (assignment.rows[0].writer_id) {
                await pool.query(`
                    INSERT INTO notifications (user_id, title, message, type, link)
                    VALUES ($1, $2, $3, $4, $5)
                `, [
                    assignment.rows[0].writer_id,
                    'New Instructions Added',
                    `Admin has added instructions for "${assignment.rows[0].title}"`,
                    'info',
                    `/assignments/${assignmentId}`
                ]);
            }
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get files for an assignment
router.get('/:assignmentId', authenticate, async (req, res) => {
    try {
        const { assignmentId } = req.params;

        // Check if writer has access
        if (req.user.role === 'writer') {
            const assignment = await pool.query('SELECT writer_id FROM assignments WHERE id = $1', [assignmentId]);
            if (assignment.rows.length === 0 || assignment.rows[0].writer_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await pool.query(`
            SELECT f.*, u.name as uploader_name
            FROM files f
            LEFT JOIN users u ON f.uploaded_by = u.id
            WHERE f.assignment_id = $1
            ORDER BY f.created_at DESC
        `, [assignmentId]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get files error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download a file
router.get('/download/:fileId', authenticate, async (req, res) => {
    try {
        const { fileId } = req.params;

        const file = await pool.query(`
            SELECT f.*, a.writer_id 
            FROM files f
            JOIN assignments a ON f.assignment_id = a.id
            WHERE f.id = $1
        `, [fileId]);

        if (file.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Check access
        if (req.user.role === 'writer' && file.rows[0].writer_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const filePath = file.rows[0].file_path;
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on server' });
        }

        res.download(filePath, file.rows[0].original_name);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete a file
router.delete('/:fileId', authenticate, async (req, res) => {
    try {
        const { fileId } = req.params;

        const file = await pool.query('SELECT * FROM files WHERE id = $1', [fileId]);
        if (file.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Only uploader or admin can delete
        if (req.user.role !== 'admin' && file.rows[0].uploaded_by !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Delete from filesystem
        if (fs.existsSync(file.rows[0].file_path)) {
            fs.unlinkSync(file.rows[0].file_path);
        }

        // Delete from database
        await pool.query('DELETE FROM files WHERE id = $1', [fileId]);

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Submit work with links (for Google Docs, etc.)
router.post('/:assignmentId/submit-links', authenticate, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { links, notes } = req.body;

        // Check assignment exists and user is assigned
        const assignment = await pool.query('SELECT * FROM assignments WHERE id = $1', [assignmentId]);
        if (assignment.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const a = assignment.rows[0];
        if (req.user.role === 'writer' && a.writer_id !== req.user.id) {
            return res.status(403).json({ error: 'You are not assigned to this job' });
        }

        // Update assignment with submission links
        await pool.query(`
            UPDATE assignments 
            SET submission_links = $1,
                submission_notes = $2,
                submitted_at = NOW()
            WHERE id = $3
        `, [links, notes, assignmentId]);

        // Notify admins
        const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
            await pool.query(`
                INSERT INTO notifications (user_id, title, message, type, link)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                admin.id,
                '🔗 Links Submitted',
                `Writer submitted work links for "${a.title}"`,
                'info',
                `/assignments`
            ]);
        }

        // Send push and Telegram
        sendPushToRole('admin', '🔗 Links Submitted', `New submission for "${a.title}"`, '/assignments');
        sendTelegramToRole('admin', 
            `🔗 <b>Work Links Submitted</b>\n\n` +
            `📋 Job: ${a.title}\n` +
            `👤 Writer: ${req.user.name}\n\n` +
            `📎 Links:\n${links}\n\n` +
            `${notes ? `📝 Notes: ${notes}\n\n` : ''}` +
            `Review the submission in HomeworkHub.`
        );

        res.json({ message: 'Links submitted successfully' });
    } catch (error) {
        console.error('Submit links error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

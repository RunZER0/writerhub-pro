const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');

// Create uploads directory for chat files
const chatUploadsDir = path.join(__dirname, '../uploads/chat');
if (!fs.existsSync(chatUploadsDir)) {
    fs.mkdirSync(chatUploadsDir, { recursive: true });
}

// Configure multer for chat file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, chatUploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'image/jpeg', 'image/png', 'image/gif'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

// Get messages for an assignment (chat thread)
router.get('/assignment/:assignmentId', authenticate, async (req, res) => {
    try {
        const { assignmentId } = req.params;

        // Verify access
        if (req.user.role === 'writer') {
            const assignment = await pool.query('SELECT writer_id FROM assignments WHERE id = $1', [assignmentId]);
            if (assignment.rows.length === 0 || assignment.rows[0].writer_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await pool.query(`
            SELECT m.*, 
                   u.name as sender_name, 
                   u.role as sender_role
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.assignment_id = $1
            ORDER BY m.created_at ASC
        `, [assignmentId]);

        // Mark messages as read
        await pool.query(`
            UPDATE messages 
            SET read_at = CURRENT_TIMESTAMP 
            WHERE assignment_id = $1 AND receiver_id = $2 AND read_at IS NULL
        `, [assignmentId, req.user.id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Send a message
router.post('/assignment/:assignmentId', authenticate, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { message } = req.body;

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }

        // Get assignment details
        const assignment = await pool.query(`
            SELECT a.*, u.name as writer_name 
            FROM assignments a 
            LEFT JOIN users u ON a.writer_id = u.id
            WHERE a.id = $1
        `, [assignmentId]);

        if (assignment.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const a = assignment.rows[0];

        // Verify access
        if (req.user.role === 'writer' && a.writer_id !== req.user.id) {
            return res.status(403).json({ error: 'You are not assigned to this job' });
        }

        // Determine receiver
        let receiverId;
        if (req.user.role === 'admin') {
            receiverId = a.writer_id;
        } else {
            // Writer sends to admin - get first admin
            const admin = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
            receiverId = admin.rows.length > 0 ? admin.rows[0].id : null;
        }

        const result = await pool.query(`
            INSERT INTO messages (assignment_id, sender_id, receiver_id, message, created_at)
            VALUES ($1, $2, $3, $4, NOW() AT TIME ZONE 'UTC')
            RETURNING *
        `, [assignmentId, req.user.id, receiverId, message.trim()]);

        // Create notification for receiver
        if (receiverId) {
            await pool.query(`
                INSERT INTO notifications (user_id, title, message, type, link)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                receiverId,
                'New Message',
                `New message in "${a.title}"`,
                'info',
                `/chat/${assignmentId}`
            ]);
        }

        // Get full message with sender info
        const fullMessage = await pool.query(`
            SELECT m.*, u.name as sender_name, u.role as sender_role
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.id = $1
        `, [result.rows[0].id]);

        res.json(fullMessage.rows[0]);
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Upload file in assignment chat
router.post('/assignment/:assignmentId/file', authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { assignmentId } = req.params;
        const message = req.body.message || '';

        // Get assignment details
        const assignment = await pool.query(`
            SELECT a.*, u.name as writer_name 
            FROM assignments a 
            LEFT JOIN users u ON a.writer_id = u.id
            WHERE a.id = $1
        `, [assignmentId]);

        if (assignment.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        const a = assignment.rows[0];

        // Verify access
        if (req.user.role === 'writer' && a.writer_id !== req.user.id) {
            return res.status(403).json({ error: 'You are not assigned to this job' });
        }

        // Determine receiver
        let receiverId;
        if (req.user.role === 'admin') {
            receiverId = a.writer_id;
        } else {
            const admin = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
            receiverId = admin.rows.length > 0 ? admin.rows[0].id : null;
        }

        const fileUrl = `/uploads/chat/${req.file.filename}`;

        const result = await pool.query(`
            INSERT INTO messages (assignment_id, sender_id, receiver_id, message, file_url, file_name, file_type, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() AT TIME ZONE 'UTC')
            RETURNING *
        `, [assignmentId, req.user.id, receiverId, message, fileUrl, req.file.originalname, req.file.mimetype]);

        // Create notification
        if (receiverId) {
            await pool.query(`
                INSERT INTO notifications (user_id, title, message, type, link)
                VALUES ($1, $2, $3, $4, $5)
            `, [receiverId, 'New File', `File shared in "${a.title}"`, 'info', `/chat/${assignmentId}`]);
        }

        const fullMessage = await pool.query(`
            SELECT m.*, u.name as sender_name, u.role as sender_role
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.id = $1
        `, [result.rows[0].id]);

        res.json(fullMessage.rows[0]);
    } catch (error) {
        console.error('Upload file error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Upload file in direct chat
router.post('/direct/:userId/file', authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { userId } = req.params;
        const message = req.body.message || '';

        // Verify receiver exists
        const receiver = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [userId]);
        if (receiver.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Writers can only message admins
        if (req.user.role === 'writer' && receiver.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Writers can only message admins' });
        }

        const fileUrl = `/uploads/chat/${req.file.filename}`;

        const result = await pool.query(`
            INSERT INTO messages (assignment_id, sender_id, receiver_id, message, file_url, file_name, file_type, created_at)
            VALUES (NULL, $1, $2, $3, $4, $5, $6, NOW() AT TIME ZONE 'UTC')
            RETURNING *
        `, [req.user.id, userId, message, fileUrl, req.file.originalname, req.file.mimetype]);

        // Notification
        await pool.query(`
            INSERT INTO notifications (user_id, title, message, type, link)
            VALUES ($1, $2, $3, $4, $5)
        `, [userId, 'New File', `File shared by ${req.user.name}`, 'info', `/chat/direct/${req.user.id}`]);

        const fullMessage = await pool.query(`
            SELECT m.*, u.name as sender_name, u.role as sender_role
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.id = $1
        `, [result.rows[0].id]);

        res.json(fullMessage.rows[0]);
    } catch (error) {
        console.error('Upload direct file error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all chat threads
router.get('/threads', authenticate, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            // Admin sees all writers they can chat with (assignment-based + all active writers)
            const result = await pool.query(`
                SELECT 
                    a.id as assignment_id,
                    a.title,
                    a.writer_id,
                    u.name as writer_name,
                    u.is_online as writer_online,
                    u.last_seen as writer_last_seen,
                    COUNT(m.id) FILTER (WHERE m.receiver_id = $1 AND m.read_at IS NULL) as unread_count,
                    MAX(m.created_at) as last_message_at
                FROM assignments a
                LEFT JOIN users u ON a.writer_id = u.id
                LEFT JOIN messages m ON m.assignment_id = a.id
                WHERE a.writer_id IS NOT NULL
                GROUP BY a.id, a.title, a.writer_id, u.name, u.is_online, u.last_seen
                HAVING COUNT(m.id) > 0 OR a.status NOT IN ('completed', 'cancelled')
                ORDER BY MAX(m.created_at) DESC NULLS LAST
            `, [req.user.id]);

            res.json(result.rows);
        } else {
            // Writer sees all admins + their assignment threads
            const admins = await pool.query(`
                SELECT 
                    id as user_id,
                    name,
                    is_online,
                    last_seen,
                    'admin' as chat_type
                FROM users 
                WHERE role = 'admin' AND status = 'active'
                ORDER BY name
            `);

            // Also get assignment-based threads
            const assignmentThreads = await pool.query(`
                SELECT 
                    a.id as assignment_id,
                    a.title,
                    COUNT(m.id) FILTER (WHERE m.receiver_id = $1 AND m.read_at IS NULL) as unread_count,
                    MAX(m.created_at) as last_message_at,
                    'assignment' as chat_type
                FROM assignments a
                LEFT JOIN messages m ON m.assignment_id = a.id
                WHERE a.writer_id = $1
                GROUP BY a.id, a.title
                HAVING COUNT(m.id) > 0 OR a.status NOT IN ('completed', 'cancelled')
                ORDER BY MAX(m.created_at) DESC NULLS LAST
            `, [req.user.id]);

            res.json({
                admins: admins.rows,
                assignments: assignmentThreads.rows
            });
        }
    } catch (error) {
        console.error('Get threads error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get direct messages with a specific user (not assignment-based)
router.get('/direct/:userId', authenticate, async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await pool.query(`
            SELECT m.*, 
                   u.name as sender_name, 
                   u.role as sender_role
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.assignment_id IS NULL 
              AND ((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1))
            ORDER BY m.created_at ASC
        `, [req.user.id, userId]);

        // Mark messages as read
        await pool.query(`
            UPDATE messages 
            SET read_at = CURRENT_TIMESTAMP 
            WHERE assignment_id IS NULL AND sender_id = $1 AND receiver_id = $2 AND read_at IS NULL
        `, [userId, req.user.id]);

        res.json(result.rows);
    } catch (error) {
        console.error('Get direct messages error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Send a direct message to a user (not assignment-based)
router.post('/direct/:userId', authenticate, async (req, res) => {
    try {
        const { userId } = req.params;
        const { message } = req.body;

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }

        // Verify the receiver exists
        const receiver = await pool.query('SELECT id, name, role FROM users WHERE id = $1', [userId]);
        if (receiver.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Writers can only message admins, admins can message anyone
        if (req.user.role === 'writer' && receiver.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Writers can only message admins' });
        }

        const result = await pool.query(`
            INSERT INTO messages (assignment_id, sender_id, receiver_id, message, created_at)
            VALUES (NULL, $1, $2, $3, NOW() AT TIME ZONE 'UTC')
            RETURNING *
        `, [req.user.id, userId, message.trim()]);

        // Create notification for receiver
        await pool.query(`
            INSERT INTO notifications (user_id, title, message, type, link)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            userId,
            'New Message',
            `New message from ${req.user.name}`,
            'info',
            `/chat/direct/${req.user.id}`
        ]);

        // Get full message with sender info
        const fullMessage = await pool.query(`
            SELECT m.*, u.name as sender_name, u.role as sender_role
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.id = $1
        `, [result.rows[0].id]);

        res.json(fullMessage.rows[0]);
    } catch (error) {
        console.error('Send direct message error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get unread message count
router.get('/unread', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT COUNT(*) as count
            FROM messages
            WHERE receiver_id = $1 AND read_at IS NULL
        `, [req.user.id]);

        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update user's online status
router.post('/status', authenticate, async (req, res) => {
    try {
        const { online } = req.body;

        await pool.query(`
            UPDATE users 
            SET is_online = $1, last_seen = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [online, req.user.id]);

        res.json({ success: true });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get user's online status
router.get('/status/:userId', authenticate, async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await pool.query(`
            SELECT is_online, last_seen, name
            FROM users
            WHERE id = $1
        `, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

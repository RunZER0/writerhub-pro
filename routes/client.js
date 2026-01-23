const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const webpush = require('web-push');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '..', 'uploads', 'client');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.doc', '.docx', '.txt'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

// Submit assignment from client portal
router.post('/submit', upload.array('files', 5), async (req, res) => {
    try {
        const {
            title,
            domain,
            description,
            word_count_min,
            word_count_max,
            deadline,
            links,
            client_name,
            client_email,
            client_phone
        } = req.body;

        // Validate required fields
        if (!title || !domain || !description || !deadline || !client_name || !client_email) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Build word count string
        const wordCount = `${word_count_min}-${word_count_max}`;

        // Format client info for description
        const clientInfo = `\n\n--- CLIENT INFO ---\nName: ${client_name}\nEmail: ${client_email}${client_phone ? `\nPhone: ${client_phone}` : ''}`;
        
        // Format links if provided
        const linksInfo = links ? `\n\n--- REFERENCE LINKS ---\n${links}` : '';
        
        // Full description with client info
        const fullDescription = description + linksInfo + clientInfo;

        // Get uploaded file paths
        const filePaths = req.files ? req.files.map(f => `/uploads/client/${f.filename}`).join(',') : null;

        // Insert assignment into database
        const result = await pool.query(
            `INSERT INTO assignments (title, description, word_count, client_deadline, domain, files, status, created_at, client_source)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), 'client_portal')
             RETURNING id`,
            [title, fullDescription, wordCount, deadline, domain, filePaths]
        );

        const assignmentId = result.rows[0].id;

        // Notify all admins
        await notifyAdminsNewAssignment(assignmentId, title, domain, client_name, client_email);

        res.json({
            success: true,
            assignment_id: assignmentId,
            message: 'Assignment submitted successfully'
        });

    } catch (error) {
        console.error('Error submitting client assignment:', error);
        res.status(500).json({ error: 'Failed to submit assignment' });
    }
});

// Notify admins about new client assignment
async function notifyAdminsNewAssignment(assignmentId, title, domain, clientName, clientEmail) {
    try {
        // Get all admin users
        const admins = await pool.query(
            `SELECT id, push_subscription, telegram_chat_id FROM users WHERE role = 'admin'`
        );

        const message = `📋 New Client Assignment!\n\nTitle: ${title}\nDomain: ${domain}\nClient: ${clientName}\nEmail: ${clientEmail}\n\nID: #${assignmentId}`;

        for (const admin of admins.rows) {
            // Send push notification
            if (admin.push_subscription) {
                try {
                    await webpush.sendNotification(
                        JSON.parse(admin.push_subscription),
                        JSON.stringify({
                            title: '📋 New Client Assignment',
                            body: `${title} from ${clientName}`,
                            icon: '/icons/icon-192.png',
                            tag: `client-assignment-${assignmentId}`,
                            data: { url: '/writers' }
                        })
                    );
                } catch (err) {
                    console.error('Push notification failed:', err.message);
                }
            }

            // Send Telegram notification
            if (admin.telegram_chat_id) {
                try {
                    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
                    if (telegramToken) {
                        const fetch = require('node-fetch');
                        await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: admin.telegram_chat_id,
                                text: message,
                                parse_mode: 'HTML'
                            })
                        });
                    }
                } catch (err) {
                    console.error('Telegram notification failed:', err.message);
                }
            }
        }

        // Also create an in-app notification for all admins
        for (const admin of admins.rows) {
            await pool.query(
                `INSERT INTO notifications (user_id, type, title, message, link, created_at)
                 VALUES ($1, 'client_assignment', $2, $3, $4, NOW())`,
                [admin.id, 'New Client Assignment', `${title} from ${clientName}`, '/writers']
            );
        }

    } catch (error) {
        console.error('Error notifying admins:', error);
    }
}

module.exports = router;

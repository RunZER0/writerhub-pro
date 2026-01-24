const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const jwt = require('jsonwebtoken');

// Generate ticket number
function generateTicketNumber() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `HP-${timestamp}-${random}`;
}

// Auth middleware for member routes
const authenticateMember = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'homework-pal-secret');
        if (decoded.type !== 'client_member') {
            return res.status(403).json({ error: 'Invalid token type' });
        }
        req.member = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Auth middleware for admin routes
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

// Auto-acknowledgment message
const AUTO_ACK_MESSAGE = `Thank you for reaching out to HomeworkPal! 🎓

We've received your message and our support team has been notified. One of our team members will respond to your inquiry shortly.

In the meantime, here are some helpful resources:
• Check our FAQ section for common questions
• For urgent matters, use our Priority Support (available for verified members)

We typically respond within 2-4 hours during business hours.

Thank you for your patience!
— The HomeworkPal Team`;

// ============== MEMBER INQUIRY ROUTES ==============

// Create new inquiry (for logged-in members)
router.post('/create', authenticateMember, async (req, res) => {
    try {
        const { subject, message } = req.body;
        const memberId = req.member.memberId;

        if (!subject || !message) {
            return res.status(400).json({ error: 'Subject and message are required' });
        }

        // Get member info
        const memberResult = await pool.query(
            'SELECT name, email FROM client_members WHERE id = $1',
            [memberId]
        );
        const member = memberResult.rows[0];

        const ticketNumber = generateTicketNumber();

        // Create inquiry
        const inquiryResult = await pool.query(`
            INSERT INTO client_inquiries (member_id, subject, ticket_number, status)
            VALUES ($1, $2, $3, 'open')
            RETURNING *
        `, [memberId, subject, ticketNumber]);

        const inquiry = inquiryResult.rows[0];

        // Add user's message
        await pool.query(`
            INSERT INTO inquiry_messages (inquiry_id, sender_type, sender_id, sender_name, message)
            VALUES ($1, 'member', $2, $3, $4)
        `, [inquiry.id, memberId, member.name, message]);

        // Add auto-acknowledgment as system message
        await pool.query(`
            INSERT INTO inquiry_messages (inquiry_id, sender_type, sender_name, message, is_system_message)
            VALUES ($1, 'system', 'HomeworkPal Support', $2, TRUE)
        `, [inquiry.id, AUTO_ACK_MESSAGE]);

        // Notify all admins
        await notifyAdminsNewInquiry(inquiry.id, ticketNumber, subject, member.name, member.email, message);

        res.json({
            success: true,
            inquiry: {
                id: inquiry.id,
                ticketNumber: inquiry.ticket_number,
                subject: inquiry.subject,
                status: inquiry.status,
                createdAt: inquiry.created_at
            }
        });

    } catch (error) {
        console.error('Error creating inquiry:', error);
        res.status(500).json({ error: 'Failed to create inquiry' });
    }
});

// Get member's inquiries
router.get('/my-inquiries', authenticateMember, async (req, res) => {
    try {
        const memberId = req.member.memberId;

        const result = await pool.query(`
            SELECT 
                ci.*,
                u.name as admin_name,
                (SELECT COUNT(*) FROM inquiry_messages im 
                 WHERE im.inquiry_id = ci.id 
                 AND im.sender_type = 'admin' 
                 AND im.read_at IS NULL) as unread_count,
                (SELECT message FROM inquiry_messages 
                 WHERE inquiry_id = ci.id 
                 ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT created_at FROM inquiry_messages 
                 WHERE inquiry_id = ci.id 
                 ORDER BY created_at DESC LIMIT 1) as last_message_at
            FROM client_inquiries ci
            LEFT JOIN users u ON ci.assigned_admin_id = u.id
            WHERE ci.member_id = $1
            ORDER BY ci.updated_at DESC
        `, [memberId]);

        res.json({ inquiries: result.rows });

    } catch (error) {
        console.error('Error fetching inquiries:', error);
        res.status(500).json({ error: 'Failed to fetch inquiries' });
    }
});

// Get messages for an inquiry
router.get('/:inquiryId/messages', authenticateMember, async (req, res) => {
    try {
        const { inquiryId } = req.params;
        const memberId = req.member.memberId;

        // Verify ownership
        const inquiry = await pool.query(
            'SELECT * FROM client_inquiries WHERE id = $1 AND member_id = $2',
            [inquiryId, memberId]
        );

        if (inquiry.rows.length === 0) {
            return res.status(404).json({ error: 'Inquiry not found' });
        }

        // Get messages
        const messages = await pool.query(`
            SELECT * FROM inquiry_messages 
            WHERE inquiry_id = $1 
            ORDER BY created_at ASC
        `, [inquiryId]);

        // Mark admin messages as read
        await pool.query(`
            UPDATE inquiry_messages 
            SET read_at = NOW() 
            WHERE inquiry_id = $1 AND sender_type = 'admin' AND read_at IS NULL
        `, [inquiryId]);

        res.json({
            inquiry: inquiry.rows[0],
            messages: messages.rows
        });

    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Send message in inquiry
router.post('/:inquiryId/message', authenticateMember, async (req, res) => {
    try {
        const { inquiryId } = req.params;
        const { message } = req.body;
        const memberId = req.member.memberId;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Verify ownership and get inquiry details
        const inquiry = await pool.query(`
            SELECT ci.*, cm.name as member_name, cm.email as member_email
            FROM client_inquiries ci
            JOIN client_members cm ON ci.member_id = cm.id
            WHERE ci.id = $1 AND ci.member_id = $2
        `, [inquiryId, memberId]);

        if (inquiry.rows.length === 0) {
            return res.status(404).json({ error: 'Inquiry not found' });
        }

        const inq = inquiry.rows[0];

        // Add message
        const result = await pool.query(`
            INSERT INTO inquiry_messages (inquiry_id, sender_type, sender_id, sender_name, message)
            VALUES ($1, 'member', $2, $3, $4)
            RETURNING *
        `, [inquiryId, memberId, inq.member_name, message]);

        // Update inquiry timestamp
        await pool.query(
            'UPDATE client_inquiries SET updated_at = NOW() WHERE id = $1',
            [inquiryId]
        );

        // Notify assigned admin or all admins
        if (inq.assigned_admin_id) {
            await notifyAdminNewMessage(inq.assigned_admin_id, inquiryId, inq.ticket_number, inq.member_name, message);
        } else {
            await notifyAdminsNewInquiry(inquiryId, inq.ticket_number, inq.subject, inq.member_name, inq.member_email, message);
        }

        res.json({ success: true, message: result.rows[0] });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// ============== ADMIN INQUIRY ROUTES ==============

// Get all inquiries (admin)
router.get('/admin/all', authenticateAdmin, async (req, res) => {
    try {
        const { status, assigned } = req.query;

        let query = `
            SELECT 
                ci.*,
                cm.name as member_name,
                cm.email as member_email,
                u.name as admin_name,
                (SELECT COUNT(*) FROM inquiry_messages im 
                 WHERE im.inquiry_id = ci.id 
                 AND im.sender_type = 'member' 
                 AND im.read_at IS NULL) as unread_count,
                (SELECT message FROM inquiry_messages 
                 WHERE inquiry_id = ci.id 
                 ORDER BY created_at DESC LIMIT 1) as last_message
            FROM client_inquiries ci
            LEFT JOIN client_members cm ON ci.member_id = cm.id
            LEFT JOIN users u ON ci.assigned_admin_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            params.push(status);
            query += ` AND ci.status = $${params.length}`;
        }

        if (assigned === 'me') {
            params.push(req.user.id);
            query += ` AND ci.assigned_admin_id = $${params.length}`;
        } else if (assigned === 'unassigned') {
            query += ` AND ci.assigned_admin_id IS NULL`;
        }

        query += ` ORDER BY ci.updated_at DESC`;

        const result = await pool.query(query, params);
        res.json({ inquiries: result.rows });

    } catch (error) {
        console.error('Error fetching inquiries:', error);
        res.status(500).json({ error: 'Failed to fetch inquiries' });
    }
});

// Pick/assign inquiry (admin)
router.post('/admin/:inquiryId/assign', authenticateAdmin, async (req, res) => {
    try {
        const { inquiryId } = req.params;
        const adminId = req.user.id;

        // Check if already assigned
        const inquiry = await pool.query(
            'SELECT * FROM client_inquiries WHERE id = $1',
            [inquiryId]
        );

        if (inquiry.rows.length === 0) {
            return res.status(404).json({ error: 'Inquiry not found' });
        }

        if (inquiry.rows[0].assigned_admin_id && inquiry.rows[0].assigned_admin_id !== adminId) {
            return res.status(400).json({ error: 'This inquiry is already assigned to another admin' });
        }

        // Assign to admin
        await pool.query(`
            UPDATE client_inquiries 
            SET assigned_admin_id = $1, assigned_at = NOW(), status = 'in-progress'
            WHERE id = $2
        `, [adminId, inquiryId]);

        // Get admin name
        const admin = await pool.query('SELECT name FROM users WHERE id = $1', [adminId]);

        // Add system message
        await pool.query(`
            INSERT INTO inquiry_messages (inquiry_id, sender_type, sender_name, message, is_system_message)
            VALUES ($1, 'system', 'System', $2, TRUE)
        `, [inquiryId, `${admin.rows[0].name} is now handling this inquiry.`]);

        res.json({ success: true, message: 'Inquiry assigned successfully' });

    } catch (error) {
        console.error('Error assigning inquiry:', error);
        res.status(500).json({ error: 'Failed to assign inquiry' });
    }
});

// Get inquiry messages (admin)
router.get('/admin/:inquiryId/messages', authenticateAdmin, async (req, res) => {
    try {
        const { inquiryId } = req.params;

        const inquiry = await pool.query(`
            SELECT ci.*, cm.name as member_name, cm.email as member_email
            FROM client_inquiries ci
            LEFT JOIN client_members cm ON ci.member_id = cm.id
            WHERE ci.id = $1
        `, [inquiryId]);

        if (inquiry.rows.length === 0) {
            return res.status(404).json({ error: 'Inquiry not found' });
        }

        const messages = await pool.query(`
            SELECT * FROM inquiry_messages 
            WHERE inquiry_id = $1 
            ORDER BY created_at ASC
        `, [inquiryId]);

        // Mark member messages as read
        await pool.query(`
            UPDATE inquiry_messages 
            SET read_at = NOW() 
            WHERE inquiry_id = $1 AND sender_type = 'member' AND read_at IS NULL
        `, [inquiryId]);

        res.json({
            inquiry: inquiry.rows[0],
            messages: messages.rows
        });

    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Send admin message
router.post('/admin/:inquiryId/message', authenticateAdmin, async (req, res) => {
    try {
        const { inquiryId } = req.params;
        const { message } = req.body;
        const adminId = req.user.id;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Get inquiry and admin info
        const inquiry = await pool.query(`
            SELECT ci.*, cm.email as member_email
            FROM client_inquiries ci
            LEFT JOIN client_members cm ON ci.member_id = cm.id
            WHERE ci.id = $1
        `, [inquiryId]);

        if (inquiry.rows.length === 0) {
            return res.status(404).json({ error: 'Inquiry not found' });
        }

        const admin = await pool.query('SELECT name FROM users WHERE id = $1', [adminId]);

        // Auto-assign if not assigned
        if (!inquiry.rows[0].assigned_admin_id) {
            await pool.query(`
                UPDATE client_inquiries 
                SET assigned_admin_id = $1, assigned_at = NOW(), status = 'in-progress'
                WHERE id = $2
            `, [adminId, inquiryId]);
        }

        // Add message
        const result = await pool.query(`
            INSERT INTO inquiry_messages (inquiry_id, sender_type, sender_id, sender_name, message)
            VALUES ($1, 'admin', $2, $3, $4)
            RETURNING *
        `, [inquiryId, adminId, admin.rows[0].name, message]);

        // Update inquiry timestamp
        await pool.query(
            'UPDATE client_inquiries SET updated_at = NOW() WHERE id = $1',
            [inquiryId]
        );

        // TODO: Send email notification to member about new reply

        res.json({ success: true, message: result.rows[0] });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Close inquiry (admin)
router.post('/admin/:inquiryId/close', authenticateAdmin, async (req, res) => {
    try {
        const { inquiryId } = req.params;
        const { resolution } = req.body;

        await pool.query(`
            UPDATE client_inquiries 
            SET status = 'closed', closed_at = NOW()
            WHERE id = $1
        `, [inquiryId]);

        // Add system message
        await pool.query(`
            INSERT INTO inquiry_messages (inquiry_id, sender_type, sender_name, message, is_system_message)
            VALUES ($1, 'system', 'System', $2, TRUE)
        `, [inquiryId, `This inquiry has been resolved and closed. ${resolution || ''}`]);

        res.json({ success: true });

    } catch (error) {
        console.error('Error closing inquiry:', error);
        res.status(500).json({ error: 'Failed to close inquiry' });
    }
});

// Reopen inquiry
router.post('/admin/:inquiryId/reopen', authenticateAdmin, async (req, res) => {
    try {
        const { inquiryId } = req.params;

        await pool.query(`
            UPDATE client_inquiries 
            SET status = 'open', closed_at = NULL
            WHERE id = $1
        `, [inquiryId]);

        await pool.query(`
            INSERT INTO inquiry_messages (inquiry_id, sender_type, sender_name, message, is_system_message)
            VALUES ($1, 'system', 'System', 'This inquiry has been reopened.', TRUE)
        `, [inquiryId]);

        res.json({ success: true });

    } catch (error) {
        console.error('Error reopening inquiry:', error);
        res.status(500).json({ error: 'Failed to reopen inquiry' });
    }
});

// ============== NOTIFICATION HELPERS ==============

async function notifyAdminsNewInquiry(inquiryId, ticketNumber, subject, memberName, memberEmail, message) {
    try {
        const admins = await pool.query(
            `SELECT id, push_subscription, telegram_chat_id FROM users WHERE role = 'admin'`
        );

        const subjectLabels = {
            pricing: '💰 Pricing Question',
            custom: '🎯 Custom Order',
            revision: '📝 Revision Request',
            deadline: '⏰ Deadline Extension',
            refund: '💸 Refund Request',
            other: '❓ Other'
        };

        const subjectLabel = subjectLabels[subject] || subject;
        const telegramMessage = `📩 <b>New Client Inquiry</b>\n\n🎫 ${ticketNumber}\n${subjectLabel}\n\nFrom: ${memberName}\nEmail: ${memberEmail}\n\n"${message.substring(0, 200)}..."`;

        for (const admin of admins.rows) {
            // Send push notification
            if (admin.push_subscription) {
                try {
                    const webpush = require('web-push');
                    await webpush.sendNotification(
                        JSON.parse(admin.push_subscription),
                        JSON.stringify({
                            title: `📩 ${subjectLabel}`,
                            body: `${ticketNumber} from ${memberName}`,
                            icon: '/icons/icon-192.png',
                            tag: `inquiry-${inquiryId}`,
                            data: { url: '/inquiries' }
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
                                text: telegramMessage,
                                parse_mode: 'HTML'
                            })
                        });
                    }
                } catch (err) {
                    console.error('Telegram notification failed:', err.message);
                }
            }

            // Create in-app notification
            await pool.query(
                `INSERT INTO notifications (user_id, type, title, message, link, created_at)
                 VALUES ($1, 'client_inquiry', $2, $3, $4, NOW())`,
                [admin.id, `New Inquiry: ${ticketNumber}`, `${subjectLabel} from ${memberName}`, '/inquiries']
            );
        }
    } catch (error) {
        console.error('Error notifying admins:', error);
    }
}

async function notifyAdminNewMessage(adminId, inquiryId, ticketNumber, memberName, message) {
    try {
        const admin = await pool.query(
            `SELECT push_subscription, telegram_chat_id FROM users WHERE id = $1`,
            [adminId]
        );

        if (admin.rows.length === 0) return;

        const adm = admin.rows[0];

        // Push notification
        if (adm.push_subscription) {
            try {
                const webpush = require('web-push');
                await webpush.sendNotification(
                    JSON.parse(adm.push_subscription),
                    JSON.stringify({
                        title: `💬 New Reply - ${ticketNumber}`,
                        body: `${memberName}: ${message.substring(0, 50)}...`,
                        icon: '/icons/icon-192.png',
                        tag: `inquiry-reply-${inquiryId}`,
                        data: { url: `/inquiries?id=${inquiryId}` }
                    })
                );
            } catch (err) {
                console.error('Push notification failed:', err.message);
            }
        }

        // Telegram
        if (adm.telegram_chat_id) {
            try {
                const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
                if (telegramToken) {
                    const fetch = require('node-fetch');
                    await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: adm.telegram_chat_id,
                            text: `💬 <b>New Reply</b>\n\n🎫 ${ticketNumber}\nFrom: ${memberName}\n\n"${message.substring(0, 200)}..."`,
                            parse_mode: 'HTML'
                        })
                    });
                }
            } catch (err) {
                console.error('Telegram notification failed:', err.message);
            }
        }

        // In-app notification
        await pool.query(
            `INSERT INTO notifications (user_id, type, title, message, link, created_at)
             VALUES ($1, 'inquiry_reply', $2, $3, $4, NOW())`,
            [adminId, `Reply: ${ticketNumber}`, `${memberName}: ${message.substring(0, 100)}...`, `/inquiries?id=${inquiryId}`]
        );

    } catch (error) {
        console.error('Error notifying admin:', error);
    }
}

module.exports = router;

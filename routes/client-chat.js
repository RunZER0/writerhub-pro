const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
// Note: Using native fetch (Node.js 18+)

// ============ PRIVACY PROTECTION ============
// Writers see: "Client" (no name, no email, no phone)
// Clients see: "Your Expert" (no writer name, no contact info)
// This prevents undercutting and direct dealing

// Auth middleware for writers
const authenticateWriter = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        req.user = decoded;
        req.writerId = decoded.id;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Auth middleware for clients (via assignment access token)
const authenticateClient = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    try {
        // Client tokens are assignment-specific
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'homework-pal-secret');
        if (decoded.type !== 'client_chat') {
            return res.status(401).json({ error: 'Invalid client token' });
        }
        req.assignmentId = decoded.assignmentId;
        req.clientEmail = decoded.clientEmail;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

// Generate client access token for an assignment
function generateClientChatToken(assignmentId, clientEmail) {
    return jwt.sign(
        { 
            type: 'client_chat',
            assignmentId,
            clientEmail 
        },
        process.env.JWT_SECRET || 'homework-pal-secret',
        { expiresIn: '30d' }
    );
}

// ============ WRITER ENDPOINTS ============

// Get client chat for an assignment (writer view)
router.get('/writer/:assignmentId', authenticateWriter, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        
        // Verify writer is assigned to this assignment
        const assignment = await pool.query(
            `SELECT a.*, a.client_chat_enabled,
                    CASE WHEN a.writer_id = $1 THEN TRUE ELSE FALSE END as is_assigned
             FROM assignments a
             WHERE a.id = $2`,
            [req.writerId, assignmentId]
        );
        
        if (assignment.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        
        if (!assignment.rows[0].is_assigned) {
            return res.status(403).json({ error: 'You are not assigned to this assignment' });
        }
        
        if (!assignment.rows[0].client_chat_enabled) {
            return res.status(403).json({ error: 'Client chat is not enabled for this assignment' });
        }
        
        // Get messages (hide client personal info)
        const messages = await pool.query(
            `SELECT id, sender_type, message, file_url, file_name, is_read, created_at
             FROM client_messages
             WHERE assignment_id = $1
             ORDER BY created_at ASC`,
            [assignmentId]
        );
        
        // Mark client messages as read
        await pool.query(
            `UPDATE client_messages 
             SET is_read = TRUE 
             WHERE assignment_id = $1 AND sender_type = 'client' AND is_read = FALSE`,
            [assignmentId]
        );
        
        // Update writer's last seen
        await pool.query(
            `UPDATE assignments SET writer_last_seen_client_chat = NOW() WHERE id = $1`,
            [assignmentId]
        );
        
        res.json({
            success: true,
            enabled: true,
            messages: messages.rows.map(m => ({
                ...m,
                senderLabel: m.sender_type === 'writer' ? 'You' : 
                             m.sender_type === 'client' ? 'Client' : 
                             m.sender_type === 'admin' ? 'Support' : 'System'
            }))
        });
        
    } catch (error) {
        console.error('Error fetching client chat:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Send message to client (writer)
router.post('/writer/:assignmentId/send', authenticateWriter, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { message, fileUrl, fileName } = req.body;
        
        if (!message?.trim() && !fileUrl) {
            return res.status(400).json({ error: 'Message or file required' });
        }
        
        // Verify assignment and chat enabled
        const assignment = await pool.query(
            `SELECT a.*, a.client_chat_enabled, a.description,
                    CASE WHEN a.writer_id = $1 THEN TRUE ELSE FALSE END as is_assigned
             FROM assignments a
             WHERE a.id = $2`,
            [req.writerId, assignmentId]
        );
        
        if (assignment.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        
        if (!assignment.rows[0].is_assigned) {
            return res.status(403).json({ error: 'You are not assigned to this assignment' });
        }
        
        if (!assignment.rows[0].client_chat_enabled) {
            return res.status(403).json({ error: 'Client chat is not enabled' });
        }
        
        // Insert message
        const result = await pool.query(
            `INSERT INTO client_messages (assignment_id, sender_type, sender_id, message, file_url, file_name)
             VALUES ($1, 'writer', $2, $3, $4, $5)
             RETURNING *`,
            [assignmentId, req.writerId, message?.trim() || '', fileUrl, fileName]
        );
        
        // Extract client email from assignment description
        const clientEmail = extractClientEmail(assignment.rows[0].description);
        
        // Send email notification to client (if not recently notified)
        if (clientEmail) {
            await sendClientNotification(assignmentId, clientEmail, assignment.rows[0].title);
        }
        
        res.json({
            success: true,
            message: {
                ...result.rows[0],
                senderLabel: 'You'
            }
        });
        
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// ============ CLIENT ENDPOINTS ============

// Get chat access (generates token for client)
router.post('/client/access', async (req, res) => {
    try {
        const { assignmentId, clientEmail } = req.body;
        
        if (!assignmentId || !clientEmail) {
            return res.status(400).json({ error: 'Assignment ID and email required' });
        }
        
        // Verify assignment exists and email matches
        const assignment = await pool.query(
            `SELECT id, title, description, client_chat_enabled, status
             FROM assignments WHERE id = $1`,
            [assignmentId]
        );
        
        if (assignment.rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        
        // Check if email is in the assignment description
        const storedEmail = extractClientEmail(assignment.rows[0].description);
        if (!storedEmail || storedEmail.toLowerCase() !== clientEmail.toLowerCase()) {
            return res.status(403).json({ error: 'Email does not match this assignment' });
        }
        
        if (!assignment.rows[0].client_chat_enabled) {
            return res.status(403).json({ error: 'Chat is not yet available for this assignment' });
        }
        
        // Generate access token
        const token = generateClientChatToken(assignmentId, clientEmail);
        
        res.json({
            success: true,
            token,
            assignment: {
                id: assignment.rows[0].id,
                title: assignment.rows[0].title,
                status: assignment.rows[0].status
            }
        });
        
    } catch (error) {
        console.error('Error generating chat access:', error);
        res.status(500).json({ error: 'Failed to generate access' });
    }
});

// Get messages (client view)
router.get('/client/messages', authenticateClient, async (req, res) => {
    try {
        const messages = await pool.query(
            `SELECT id, sender_type, message, file_url, file_name, is_read, created_at
             FROM client_messages
             WHERE assignment_id = $1
             ORDER BY created_at ASC`,
            [req.assignmentId]
        );
        
        // Mark writer messages as read
        await pool.query(
            `UPDATE client_messages 
             SET is_read = TRUE 
             WHERE assignment_id = $1 AND sender_type IN ('writer', 'admin') AND is_read = FALSE`,
            [req.assignmentId]
        );
        
        // Update client last seen
        await pool.query(
            `UPDATE assignments SET client_last_seen = NOW() WHERE id = $1`,
            [req.assignmentId]
        );
        
        res.json({
            success: true,
            messages: messages.rows.map(m => ({
                ...m,
                // PRIVACY: Client never sees writer identity
                senderLabel: m.sender_type === 'client' ? 'You' : 
                             m.sender_type === 'writer' ? 'Your Expert' : 
                             m.sender_type === 'admin' ? 'Support' : 'System'
            }))
        });
        
    } catch (error) {
        console.error('Error fetching client messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Send message (client)
router.post('/client/send', authenticateClient, async (req, res) => {
    try {
        const { message, fileUrl, fileName } = req.body;
        
        if (!message?.trim() && !fileUrl) {
            return res.status(400).json({ error: 'Message or file required' });
        }
        
        // Insert message
        const result = await pool.query(
            `INSERT INTO client_messages (assignment_id, sender_type, sender_id, message, file_url, file_name)
             VALUES ($1, 'client', NULL, $2, $3, $4)
             RETURNING *`,
            [req.assignmentId, message?.trim() || '', fileUrl, fileName]
        );
        
        // Get assignment and writer info for notification
        const assignment = await pool.query(
            `SELECT a.title, a.writer_id, u.push_subscription, u.email
             FROM assignments a
             LEFT JOIN users u ON a.writer_id = u.id
             WHERE a.id = $1`,
            [req.assignmentId]
        );
        
        if (assignment.rows[0]?.writer_id) {
            // Send push notification to writer
            await sendWriterNotification(
                assignment.rows[0].push_subscription,
                assignment.rows[0].title,
                message?.trim()?.substring(0, 50) || 'New file shared'
            );
        }
        
        res.json({
            success: true,
            message: {
                ...result.rows[0],
                senderLabel: 'You'
            }
        });
        
    } catch (error) {
        console.error('Error sending client message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Get unread count (client)
router.get('/client/unread', authenticateClient, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT COUNT(*) as count 
             FROM client_messages 
             WHERE assignment_id = $1 
             AND sender_type IN ('writer', 'admin') 
             AND is_read = FALSE`,
            [req.assignmentId]
        );
        
        res.json({ unread: parseInt(result.rows[0].count) });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

// ============ ADMIN ENDPOINTS ============

// Enable/disable client chat for an assignment
router.post('/admin/toggle/:assignmentId', authenticateWriter, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { enabled } = req.body;
        
        // Check if user is admin
        const user = await pool.query(
            'SELECT role FROM users WHERE id = $1',
            [req.writerId]
        );
        
        if (!user.rows[0] || user.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        await pool.query(
            'UPDATE assignments SET client_chat_enabled = $1 WHERE id = $2',
            [enabled, assignmentId]
        );
        
        // If enabling, send welcome message
        if (enabled) {
            await pool.query(
                `INSERT INTO client_messages (assignment_id, sender_type, message)
                 VALUES ($1, 'system', 'Chat has been enabled for this assignment. You can now communicate directly with your assigned expert.')`,
                [assignmentId]
            );
            
            // Get client email and send notification
            const assignment = await pool.query(
                'SELECT title, description FROM assignments WHERE id = $1',
                [assignmentId]
            );
            
            const clientEmail = extractClientEmail(assignment.rows[0]?.description);
            if (clientEmail) {
                await sendChatEnabledEmail(assignmentId, clientEmail, assignment.rows[0].title);
            }
        }
        
        res.json({ success: true, enabled });
        
    } catch (error) {
        console.error('Error toggling chat:', error);
        res.status(500).json({ error: 'Failed to toggle chat' });
    }
});

// Send message as admin/support
router.post('/admin/:assignmentId/send', authenticateWriter, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { message } = req.body;
        
        // Check if user is admin
        const user = await pool.query(
            'SELECT role FROM users WHERE id = $1',
            [req.writerId]
        );
        
        if (!user.rows[0] || user.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const result = await pool.query(
            `INSERT INTO client_messages (assignment_id, sender_type, sender_id, message)
             VALUES ($1, 'admin', $2, $3)
             RETURNING *`,
            [assignmentId, req.writerId, message]
        );
        
        res.json({
            success: true,
            message: {
                ...result.rows[0],
                senderLabel: 'Support'
            }
        });
        
    } catch (error) {
        console.error('Error sending admin message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// ============ HELPER FUNCTIONS ============

function extractClientEmail(description) {
    if (!description) return null;
    const match = description.match(/Email:\s*([^\s\n]+)/i);
    return match ? match[1].trim() : null;
}

async function sendClientNotification(assignmentId, clientEmail, title) {
    try {
        // Check if we already sent a notification today
        const recent = await pool.query(
            `SELECT id FROM chat_email_notifications 
             WHERE assignment_id = $1 
             AND recipient_type = 'client' 
             AND DATE(sent_at) = CURRENT_DATE`,
            [assignmentId]
        );
        
        if (recent.rows.length > 0) {
            return; // Already notified today
        }
        
        const brevoApiKey = process.env.BREVO_API_KEY;
        if (!brevoApiKey) return;
        
        // Generate access link
        const accessToken = generateClientChatToken(assignmentId, clientEmail);
        const chatUrl = `${process.env.BASE_URL || 'https://www.homeworkpal.online'}/client-chat.html?token=${accessToken}`;
        
        await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': brevoApiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    name: 'HomeworkPal',
                    email: process.env.SENDER_EMAIL || 'admin@homeworkpal.online'
                },
                to: [{ email: clientEmail }],
                subject: `💬 New message from your expert - ${title}`,
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
                            <h1 style="color: white; margin: 0;">HomeworkPal</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">You have a new message!</p>
                        </div>
                        <div style="padding: 30px; background: #f8fafc; border-radius: 0 0 12px 12px;">
                            <p style="color: #334155; font-size: 16px;">Your assigned expert has sent you a message regarding:</p>
                            <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #6366f1;">
                                <strong style="color: #1e293b;">${title}</strong>
                            </div>
                            <p style="color: #64748b;">Click below to view and respond:</p>
                            <a href="${chatUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 15px 0;">
                                View Message
                            </a>
                            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px;">
                                This link is unique to you. Do not share it with others.
                            </p>
                        </div>
                    </div>
                `
            })
        });
        
        // Log notification
        await pool.query(
            `INSERT INTO chat_email_notifications (assignment_id, recipient_type, recipient_email)
             VALUES ($1, 'client', $2)`,
            [assignmentId, clientEmail]
        );
        
    } catch (error) {
        console.error('Error sending client notification:', error);
    }
}

async function sendChatEnabledEmail(assignmentId, clientEmail, title) {
    try {
        const brevoApiKey = process.env.BREVO_API_KEY;
        if (!brevoApiKey) return;
        
        const accessToken = generateClientChatToken(assignmentId, clientEmail);
        const chatUrl = `${process.env.BASE_URL || 'https://www.homeworkpal.online'}/client-chat.html?token=${accessToken}`;
        
        await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': brevoApiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    name: 'HomeworkPal',
                    email: process.env.SENDER_EMAIL || 'admin@homeworkpal.online'
                },
                to: [{ email: clientEmail }],
                subject: `🎉 Chat enabled for your assignment - ${title}`,
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
                            <h1 style="color: white; margin: 0;">HomeworkPal</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">Direct Chat Now Available!</p>
                        </div>
                        <div style="padding: 30px; background: #f8fafc; border-radius: 0 0 12px 12px;">
                            <p style="color: #334155; font-size: 16px;">Great news! You can now communicate directly with your assigned expert for:</p>
                            <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #22c55e;">
                                <strong style="color: #1e293b;">${title}</strong>
                            </div>
                            <p style="color: #64748b;">Use this feature to:</p>
                            <ul style="color: #64748b;">
                                <li>Ask questions about your assignment</li>
                                <li>Provide additional instructions or clarifications</li>
                                <li>Request updates on progress</li>
                                <li>Share additional files if needed</li>
                            </ul>
                            <a href="${chatUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 15px 0;">
                                Open Chat
                            </a>
                            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px;">
                                Bookmark this link for easy access. Your expert will be notified when you send a message.
                            </p>
                        </div>
                    </div>
                `
            })
        });
        
    } catch (error) {
        console.error('Error sending chat enabled email:', error);
    }
}

async function sendWriterNotification(pushSubscription, title, messagePreview) {
    if (!pushSubscription) return;
    
    try {
        const webpush = require('web-push');
        webpush.setVapidDetails(
            'mailto:admin@homeworkpal.online',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
        
        await webpush.sendNotification(
            JSON.parse(pushSubscription),
            JSON.stringify({
                title: `💬 Client message - ${title}`,
                body: messagePreview,
                icon: '/icons/icon-192.png',
                badge: '/icons/badge-72.png'
            })
        );
    } catch (error) {
        console.error('Push notification error:', error);
    }
}

module.exports = router;

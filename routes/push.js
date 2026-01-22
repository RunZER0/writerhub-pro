const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const pool = require('../db/index');
const { authenticate } = require('../middleware/auth');

// Configure web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        'mailto:admin@homeworkhub.com',
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
    console.log('✅ Web Push configured');
} else {
    console.log('⚠️ Web Push not configured - missing VAPID keys');
}

// Get VAPID public key for frontend
router.get('/vapid-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});

// Subscribe to push notifications
router.post('/subscribe', authenticate, async (req, res) => {
    try {
        const { subscription } = req.body;
        
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ error: 'Invalid subscription' });
        }

        // Store subscription in database
        await pool.query(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, endpoint) 
            DO UPDATE SET p256dh = $3, auth = $4, updated_at = NOW()
        `, [
            req.user.id,
            subscription.endpoint,
            subscription.keys.p256dh,
            subscription.keys.auth
        ]);

        res.json({ success: true, message: 'Subscription saved' });
    } catch (error) {
        console.error('Subscribe error:', error);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

// Unsubscribe from push notifications
router.post('/unsubscribe', authenticate, async (req, res) => {
    try {
        const { endpoint } = req.body;
        
        await pool.query(
            'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
            [req.user.id, endpoint]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

// Send push notification to a user
async function sendPushToUser(userId, title, body, url = '/') {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        console.log('Push skipped - VAPID not configured');
        return;
    }

    try {
        const result = await pool.query(
            'SELECT * FROM push_subscriptions WHERE user_id = $1',
            [userId]
        );

        const payload = JSON.stringify({
            title,
            body,
            icon: '/icons/icon.svg',
            badge: '/icons/icon.svg',
            url,
            timestamp: Date.now()
        });

        for (const sub of result.rows) {
            const subscription = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                }
            };

            try {
                await webpush.sendNotification(subscription, payload);
            } catch (error) {
                if (error.statusCode === 410 || error.statusCode === 404) {
                    // Subscription expired or invalid - remove it
                    await pool.query(
                        'DELETE FROM push_subscriptions WHERE id = $1',
                        [sub.id]
                    );
                }
                console.error('Push send error:', error.message);
            }
        }
    } catch (error) {
        console.error('sendPushToUser error:', error);
    }
}

// Send push to all users with a specific role
async function sendPushToRole(role, title, body, url = '/') {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

    try {
        const users = await pool.query(
            'SELECT id FROM users WHERE role = $1 AND status = $2',
            [role, 'active']
        );

        for (const user of users.rows) {
            await sendPushToUser(user.id, title, body, url);
        }
    } catch (error) {
        console.error('sendPushToRole error:', error);
    }
}

// Send push to users in a specific domain
async function sendPushToDomain(domain, title, body, url = '/') {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

    try {
        let users;
        if (domain) {
            users = await pool.query(
                "SELECT id FROM users WHERE role = 'writer' AND status = 'active' AND domains LIKE $1",
                [`%${domain}%`]
            );
        } else {
            users = await pool.query(
                "SELECT id FROM users WHERE role = 'writer' AND status = 'active'"
            );
        }

        for (const user of users.rows) {
            await sendPushToUser(user.id, title, body, url);
        }
    } catch (error) {
        console.error('sendPushToDomain error:', error);
    }
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
module.exports.sendPushToRole = sendPushToRole;
module.exports.sendPushToDomain = sendPushToDomain;

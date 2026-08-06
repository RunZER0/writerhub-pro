const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const crypto = require('crypto');
const { isDisposableEmail } = require('../utils/disposable-emails');
const { isOwnerEmail } = require('../utils/admin-emails');

// Brevo email setup
const Brevo = require('@getbrevo/brevo');
const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

// Send verification email via Brevo
async function sendVerificationEmail(email, name, token) {
    const verifyUrl = `${process.env.BASE_URL || 'https://www.homeworkpal.online'}/api/membership/verify?token=${token}`;
    
    const sendSmtpEmail = new Brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { name: 'HomeworkPal', email: process.env.SENDER_EMAIL || 'noreply@homeworkpal.com' };
    sendSmtpEmail.to = [{ email: email, name: name }];
    sendSmtpEmail.subject = 'Verify Your HomeworkPal Account';
    sendSmtpEmail.htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .header h1 { color: white; margin: 0; font-size: 28px; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
                .verify-btn { display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                .benefits { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                .benefit { padding: 8px 0; border-bottom: 1px solid #eee; }
                .benefit:last-child { border-bottom: none; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🎓 HomeworkPal</h1>
                </div>
                <div class="content">
                    <h2>Welcome, ${name}! 👋</h2>
                    <p>Thank you for joining HomeworkPal membership. Please verify your email to activate your account and start enjoying exclusive benefits.</p>
                    
                    <div style="text-align: center;">
                        <a href="${verifyUrl}" class="verify-btn">✓ Verify My Email</a>
                    </div>
                    
                    <div class="benefits">
                        <h3>Your Member Benefits:</h3>
                        <div class="benefit">✨ <strong>5% discount</strong> on all orders (increases as you order more!)</div>
                        <div class="benefit">🚀 <strong>Priority support</strong> for faster responses</div>
                        <div class="benefit">💰 <strong>Referral rewards</strong> - earn credits for each friend you refer</div>
                        <div class="benefit">📊 <strong>Order tracking</strong> - monitor all your assignments in one place</div>
                    </div>
                    
                    <p style="color: #666; font-size: 14px;">If you didn't create this account, please ignore this email.</p>
                    <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
                </div>
                <div class="footer">
                    <p>© ${new Date().getFullYear()} HomeworkPal. All rights reserved.</p>
                    <p>Quality academic assistance you can trust.</p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    try {
        await apiInstance.sendTransacEmail(sendSmtpEmail);
        console.log(`Verification email sent to ${email}`);
        return true;
    } catch (error) {
        console.error('Failed to send verification email:', error?.body || error);
        return false;
    }
}

// ============ PUBLIC ENDPOINTS ============

// Google Auth endpoint
router.post('/google-auth', async (req, res) => {
    try {
        const { email, name, googleId, photoURL } = req.body;
        
        if (!email || !googleId) {
            return res.status(400).json({ error: 'Invalid Google authentication data' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Check for disposable email
        if (isDisposableEmail(emailLower)) {
            return res.status(400).json({ 
                error: 'Temporary or disposable email addresses are not allowed.' 
            });
        }
        
        // Check if user exists
        let member;
        const existing = await pool.query(
            'SELECT * FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (existing.rows.length > 0) {
            // Existing user - update google_id if not set
            member = existing.rows[0];
            if (!member.google_id) {
                await pool.query(
                    'UPDATE client_members SET google_id = $1, is_verified = TRUE WHERE id = $2',
                    [googleId, member.id]
                );
            }
            // Google users are auto-verified
            if (!member.is_verified) {
                await pool.query('UPDATE client_members SET is_verified = TRUE WHERE id = $1', [member.id]);
            }
            member.is_verified = true;
        } else {
            // Create new user - auto-verified since Google verifies email
            const result = await pool.query(`
                INSERT INTO client_members (email, name, google_id, is_verified, password_hash)
                VALUES ($1, $2, $3, TRUE, $4)
                RETURNING *
            `, [emailLower, name || email.split('@')[0], googleId, 'google-auth-no-password']);
            
            member = result.rows[0];
        }
        
        // Update last login
        await pool.query('UPDATE client_members SET last_login = NOW() WHERE id = $1', [member.id]);
        
        // Generate token
        const token = jwt.sign(
            { memberId: member.id, email: member.email, type: 'client_member' },
            process.env.JWT_SECRET || 'homework-pal-secret',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            token,
            member: {
                id: member.id,
                email: member.email,
                name: member.name,
                tier: member.membership_tier,
                discount: parseFloat(member.discount_percent),
                isVerified: true,
                totalOrders: member.total_orders || 0,
                totalSpent: parseFloat(member.total_spent || 0)
            }
        });
    } catch (error) {
        console.error('Google auth error:', error);
        res.status(500).json({ error: 'Authentication failed. Please try again.' });
    }
});

// Register as a member
router.post('/register', async (req, res) => {
    try {
        const { email, name, phone, password } = req.body;
        
        if (!email || !name || !password) {
            return res.status(400).json({ error: 'Email, name, and password are required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Check for disposable/temporary email
        if (isDisposableEmail(emailLower)) {
            return res.status(400).json({ 
                error: 'Temporary or disposable email addresses are not allowed. Please use a permanent email address.' 
            });
        }
        
        // Check if already registered
        const existing = await pool.query(
            'SELECT id, is_verified FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (existing.rows.length > 0) {
            const existingMember = existing.rows[0];
            if (!existingMember.is_verified) {
                // Resend verification email
                const newToken = crypto.randomBytes(32).toString('hex');
                const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
                
                await pool.query(
                    'UPDATE client_members SET verification_token = $1, token_expiry = $2 WHERE id = $3',
                    [newToken, tokenExpiry, existingMember.id]
                );
                
                await sendVerificationEmail(emailLower, name, newToken);
                
                return res.status(400).json({ 
                    error: 'Email already registered but not verified. We\'ve sent a new verification email.',
                    needsVerification: true 
                });
            }
            return res.status(400).json({ error: 'Email already registered. Please login instead.' });
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Generate verification token with expiry
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        // Create member (unverified)
        const result = await pool.query(`
            INSERT INTO client_members (email, name, phone, password_hash, verification_token, token_expiry, is_verified)
            VALUES ($1, $2, $3, $4, $5, $6, FALSE)
            RETURNING id, email, name, membership_tier, discount_percent, created_at
        `, [emailLower, name, phone || null, passwordHash, verificationToken, tokenExpiry]);
        
        const member = result.rows[0];
        
        // Send verification email — every member must verify their email, so a delivery
        // failure here is never treated as a pass; the account stays unverified and the
        // user can retry via the resend-verification endpoint.
        const emailSent = await sendVerificationEmail(emailLower, name, verificationToken);

        if (!emailSent) {
            console.error(`Verification email failed to send to ${emailLower} during registration`);
            return res.json({
                success: true,
                needsVerification: true,
                message: `Your account was created, but we ran into an issue sending the verification email to ${emailLower}. If it doesn't arrive in a few minutes, use "Resend Verification" to try again.`
            });
        }

        res.json({
            success: true,
            needsVerification: true,
            message: `We've sent a verification email to ${emailLower}. Please check your inbox and click the link to activate your account.`
        });
    } catch (error) {
        console.error('Member registration error:', error);
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});

// Login as member
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        const result = await pool.query(
            'SELECT * FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        const member = result.rows[0];
        
        // Check password
        const validPassword = await bcrypt.compare(password, member.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        if (member.status !== 'active') {
            return res.status(403).json({ error: 'Account is inactive. Please contact support.' });
        }
        
        // Update last login
        await pool.query('UPDATE client_members SET last_login = NOW() WHERE id = $1', [member.id]);
        
        // Generate token
        const token = jwt.sign(
            { memberId: member.id, email: member.email, type: 'client_member' },
            process.env.JWT_SECRET || 'homework-pal-secret',
            { expiresIn: '30d' }
        );
        
        // Allow login but indicate if unverified (restrictions apply on frontend)
        res.json({
            success: true,
            token,
            member: {
                id: member.id,
                email: member.email,
                name: member.name,
                tier: member.membership_tier,
                discount: parseFloat(member.discount_percent),
                isVerified: member.is_verified,
                totalOrders: member.total_orders,
                totalSpent: parseFloat(member.total_spent || 0)
            },
            // Show warning if unverified
            warning: !member.is_verified ? 'Please verify your email to unlock your membership discount.' : null
        });
    } catch (error) {
        console.error('Member login error:', error);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

// Email verification endpoint
router.get('/verify', async (req, res) => {
    try {
        const { token } = req.query;
        
        if (!token) {
            return res.status(400).send(getVerificationPage('error', 'Invalid verification link.'));
        }
        
        // Find member with this token
        const result = await pool.query(
            'SELECT id, email, name, token_expiry FROM client_members WHERE verification_token = $1',
            [token]
        );
        
        if (result.rows.length === 0) {
            return res.status(400).send(getVerificationPage('error', 'Invalid or expired verification link.'));
        }
        
        const member = result.rows[0];
        
        // Check if token expired
        if (member.token_expiry && new Date(member.token_expiry) < new Date()) {
            return res.status(400).send(getVerificationPage('expired', 'Verification link has expired. Please register again or request a new verification email.'));
        }
        
        // Verify the member
        await pool.query(`
            UPDATE client_members 
            SET is_verified = TRUE, verification_token = NULL, token_expiry = NULL 
            WHERE id = $1
        `, [member.id]);
        
        console.log(`Member verified: ${member.email}`);
        
        res.send(getVerificationPage('success', `Welcome to HomeworkPal, ${member.name}! Your email has been verified.`));
    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).send(getVerificationPage('error', 'Verification failed. Please try again.'));
    }
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        const result = await pool.query(
            'SELECT id, name, is_verified FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No account found with this email' });
        }
        
        const member = result.rows[0];
        
        if (member.is_verified) {
            return res.status(400).json({ error: 'Email is already verified. You can login now.' });
        }
        
        // Generate new token
        const newToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        await pool.query(
            'UPDATE client_members SET verification_token = $1, token_expiry = $2 WHERE id = $3',
            [newToken, tokenExpiry, member.id]
        );
        
        const emailSent = await sendVerificationEmail(emailLower, member.name, newToken);
        
        if (!emailSent) {
            return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
        }
        
        res.json({
            success: true,
            message: 'Verification email sent! Please check your inbox.'
        });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Failed to resend verification email.' });
    }
});

// Helper function for verification page HTML
function getVerificationPage(status, message) {
    const statusConfig = {
        success: { icon: '✓', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)' },
        error: { icon: '✗', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
        expired: { icon: '⏰', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' }
    };
    
    const config = statusConfig[status] || statusConfig.error;
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Email Verification - HomeworkPal</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Arial, sans-serif; 
                    background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .container {
                    background: rgba(255,255,255,0.05);
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 20px;
                    padding: 40px;
                    max-width: 500px;
                    text-align: center;
                }
                .icon {
                    width: 80px;
                    height: 80px;
                    border-radius: 50%;
                    background: ${config.bgColor};
                    color: ${config.color};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 40px;
                    margin: 0 auto 20px;
                }
                h1 { color: white; margin-bottom: 15px; font-size: 24px; }
                p { color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 25px; }
                .btn {
                    display: inline-block;
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    color: white;
                    padding: 12px 30px;
                    border-radius: 8px;
                    text-decoration: none;
                    font-weight: 600;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(99,102,241,0.3); }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">${config.icon}</div>
                <h1>${status === 'success' ? 'Email Verified!' : status === 'expired' ? 'Link Expired' : 'Verification Failed'}</h1>
                <p>${message}</p>
                <a href="${process.env.BASE_URL || 'https://www.homeworkpal.online'}/client.html#membership" class="btn">
                    ${status === 'success' ? 'Login to Your Account' : 'Back to Homepage'}
                </a>
            </div>
        </body>
        </html>
    `;
}

// Get membership tiers (public)
router.get('/tiers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT name, min_orders, min_spent, discount_percent, perks
            FROM membership_tiers
            ORDER BY min_orders ASC
        `);
        
        res.json(result.rows.map(tier => ({
            name: tier.name,
            minOrders: tier.min_orders,
            minSpent: parseFloat(tier.min_spent),
            discount: parseFloat(tier.discount_percent),
            perks: tier.perks ? tier.perks.split(', ') : []
        })));
    } catch (error) {
        console.error('Get tiers error:', error);
        res.status(500).json({ error: 'Failed to fetch tiers' });
    }
});

// Middleware to verify member token
function authenticateMember(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
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
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Get member profile
router.get('/profile', authenticateMember, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT cm.*, mt.perks
            FROM client_members cm
            LEFT JOIN membership_tiers mt ON cm.membership_tier = mt.name
            WHERE cm.id = $1
        `, [req.member.memberId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        const member = result.rows[0];
        
        // Get next tier info
        const nextTier = await pool.query(`
            SELECT * FROM membership_tiers
            WHERE min_orders > $1 OR min_spent > $2
            ORDER BY min_orders ASC
            LIMIT 1
        `, [member.total_orders, member.total_spent || 0]);
        
        res.json({
            member: {
                id: member.id,
                email: member.email,
                name: member.name,
                phone: member.phone,
                membership_tier: member.membership_tier,
                discount_percent: parseFloat(member.discount_percent),
                total_orders: member.total_orders,
                total_spent: parseFloat(member.total_spent || 0),
                is_verified: member.is_verified,
                perks: member.perks ? member.perks.split(', ') : [],
                memberSince: member.created_at,
                nextTier: nextTier.rows[0] ? {
                    name: nextTier.rows[0].name,
                    ordersNeeded: nextTier.rows[0].min_orders - member.total_orders,
                    spentNeeded: parseFloat(nextTier.rows[0].min_spent) - parseFloat(member.total_spent || 0),
                    discount: parseFloat(nextTier.rows[0].discount_percent)
                } : null
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Update member stats (called after order completion - internal use)
// Shared by the /update-stats route below and called directly (function call, not HTTP) from
// routes/client.js after a paid order is created, so there's one source of truth for tier math.
// orderAmountUsd must already be normalized to USD — membership_tiers thresholds are USD-denominated,
// so a KES-priced order needs to be converted using our own fixed per-page rate before calling this,
// not a live market FX rate (see routes/client.js for why).
async function updateMemberStats(email, orderAmountUsd) {
    if (!email) return { updated: false };

    const emailLower = email.toLowerCase().trim();

    const member = await pool.query('SELECT * FROM client_members WHERE email = $1', [emailLower]);
    if (member.rows.length === 0) {
        return { updated: false, reason: 'Not a member' };
    }

    const m = member.rows[0];
    const newOrderCount = m.total_orders + 1;
    const newTotalSpent = parseFloat(m.total_spent || 0) + parseFloat(orderAmountUsd || 0);

    const newTier = await pool.query(`
        SELECT * FROM membership_tiers
        WHERE min_orders <= $1 AND min_spent <= $2
        ORDER BY discount_percent DESC
        LIMIT 1
    `, [newOrderCount, newTotalSpent]);

    const tierName = newTier.rows[0]?.name || 'basic';
    const discount = newTier.rows[0]?.discount_percent || 5;

    // Auto-verify members who have completed orders (they've proven they're real customers)
    const shouldAutoVerify = newOrderCount >= 1;

    await pool.query(`
        UPDATE client_members
        SET total_orders = $1, total_spent = $2, membership_tier = $3, discount_percent = $4,
            is_verified = CASE WHEN $6 THEN TRUE ELSE is_verified END
        WHERE id = $5
    `, [newOrderCount, newTotalSpent, tierName, discount, m.id, shouldAutoVerify]);

    return {
        updated: true,
        newTier: tierName,
        newDiscount: parseFloat(discount),
        upgraded: tierName !== m.membership_tier,
        totalOrders: newOrderCount,
        totalSpent: newTotalSpent,
        autoVerified: shouldAutoVerify && !m.is_verified
    };
}

router.post('/update-stats', async (req, res) => {
    try {
        const { email, orderAmount } = req.body;
        const result = await updateMemberStats(email, orderAmount);
        res.json(result);
    } catch (error) {
        console.error('Update member stats error:', error);
        res.status(500).json({ error: 'Failed to update stats' });
    }
});

// Get member discount for an email (used during checkout) - only returns discount if verified
router.get('/discount/:email', async (req, res) => {
    try {
        const emailLower = req.params.email.toLowerCase().trim();
        
        const result = await pool.query(
            'SELECT discount_percent, membership_tier, is_verified FROM client_members WHERE email = $1 AND status = $2',
            [emailLower, 'active']
        );
        
        if (result.rows.length === 0) {
            return res.json({ isMember: false, discount: 0 });
        }
        
        const member = result.rows[0];
        
        // Only return discount if member is verified
        if (!member.is_verified) {
            return res.json({ 
                isMember: true, 
                discount: 0, 
                tier: member.membership_tier,
                message: 'Please verify your email to unlock your discount'
            });
        }
        
        res.json({
            isMember: true,
            tier: member.membership_tier,
            discount: parseFloat(member.discount_percent)
        });
    } catch (error) {
        console.error('Get discount error:', error);
        res.json({ isMember: false, discount: 0 });
    }
});

// Get member's in-app notifications
router.get('/notifications', authenticateMember, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM member_notifications
             WHERE member_id = $1
             ORDER BY created_at DESC
             LIMIT 20`,
            [req.member.memberId]
        );
        res.json({
            notifications: result.rows,
            unreadCount: result.rows.filter(n => !n.read).length
        });
    } catch (error) {
        console.error('Get member notifications error:', error);
        res.status(500).json({ error: 'Failed to get notifications' });
    }
});

// Mark a notification as read
router.put('/notifications/:id/read', authenticateMember, async (req, res) => {
    try {
        await pool.query(
            'UPDATE member_notifications SET read = TRUE WHERE id = $1 AND member_id = $2',
            [req.params.id, req.member.memberId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Mark member notification error:', error);
        res.status(500).json({ error: 'Failed to update notification' });
    }
});

// Mark all notifications as read
router.put('/notifications/read-all', authenticateMember, async (req, res) => {
    try {
        await pool.query(
            'UPDATE member_notifications SET read = TRUE WHERE member_id = $1',
            [req.member.memberId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Mark all member notifications error:', error);
        res.status(500).json({ error: 'Failed to update notifications' });
    }
});

// ============ ADMIN ENDPOINTS ============
//
// Everything under /admin/* is owner-only. These used to be completely unauthenticated,
// which meant anyone who knew the URL could list every user in the system and mint
// themselves free report slots — hence the hard gate below.

async function authenticateOwner(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'homework-pal-secret');

        // Member-issued token (the client portal / admin panel path)
        if (decoded.memberId) {
            const result = await pool.query('SELECT id, email FROM client_members WHERE id = $1', [decoded.memberId]);
            const email = result.rows[0]?.email;
            if (!isOwnerEmail(email)) {
                return res.status(403).json({ error: 'Admin access required' });
            }
            req.owner = { memberId: decoded.memberId, email };
            return next();
        }

        // Staff-app token — still has to belong to an owner email, staff alone is not enough.
        if (decoded.userId) {
            const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [decoded.userId]);
            const email = result.rows[0]?.email;
            if (!isOwnerEmail(email)) {
                return res.status(403).json({ error: 'Admin access required' });
            }
            req.owner = { userId: decoded.userId, email };
            return next();
        }

        return res.status(403).json({ error: 'Admin access required' });
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// Cheap probe the front-end uses to decide whether to render the admin panel
// instead of the client portal.
router.get('/admin/whoami', authenticateOwner, (req, res) => {
    res.json({ isOwner: true, email: req.owner.email });
});

// Headline numbers for the admin panel. Report checks and slot purchases are counted as
// orders here alongside assignments and QuickPay invoices — a scan is a sale like any other.
router.get('/admin/overview', authenticateOwner, async (req, res) => {
    try {
        const safe = async (sql, params = []) => {
            try {
                return (await pool.query(sql, params)).rows[0] || {};
            } catch (e) {
                // A table may not exist yet on a fresh database — an empty tile beats a 500.
                return {};
            }
        };

        const members = await safe(`
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE is_verified) AS verified,
                   COALESCE(SUM(turnitin_wallet_credits), 0) AS outstanding_slots
            FROM client_members
        `);

        const reports = await safe(`
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE status = 'processing') AS processing,
                   COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                   COUNT(*) FILTER (WHERE status = 'refunded') AS refunded,
                   COALESCE(SUM(amount_charged) FILTER (WHERE currency = 'USD'), 0) AS revenue_usd,
                   COALESCE(SUM(amount_charged) FILTER (WHERE currency = 'KES'), 0) AS revenue_kes
            FROM writenix_reports
        `);

        const slots = await safe(`
            SELECT COUNT(*) AS purchases,
                   COALESCE(SUM(slot_count), 0) AS slots_sold,
                   COALESCE(SUM(amount) FILTER (WHERE currency = 'USD'), 0) AS revenue_usd,
                   COALESCE(SUM(amount) FILTER (WHERE currency = 'KES'), 0) AS revenue_kes
            FROM slot_purchases
        `);

        const quickpay = await safe(`
            SELECT COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_invoices,
                   COALESCE(SUM(amount) FILTER (WHERE payment_status = 'paid' AND currency = 'KES'), 0) AS revenue_kes,
                   COALESCE(SUM(amount) FILTER (WHERE payment_status = 'paid' AND COALESCE(currency, 'USD') <> 'KES'), 0) AS revenue_usd
            FROM quickpay_invoices
        `);

        const assignments = await safe(`
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                   COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) AS revenue_usd
            FROM assignments
        `);

        const num = (v) => parseFloat(v || 0);
        const int = (v) => parseInt(v || 0, 10);

        const totalOrders = int(reports.total) + int(slots.purchases) + int(quickpay.paid_invoices) + int(assignments.total);
        const revenueUsd = num(reports.revenue_usd) + num(slots.revenue_usd) + num(quickpay.revenue_usd) + num(assignments.revenue_usd);
        const revenueKes = num(reports.revenue_kes) + num(slots.revenue_kes) + num(quickpay.revenue_kes);

        res.json({
            members: {
                total: int(members.total),
                verified: int(members.verified),
                outstandingSlots: int(members.outstanding_slots)
            },
            reports: {
                total: int(reports.total),
                processing: int(reports.processing),
                completed: int(reports.completed),
                refunded: int(reports.refunded),
                revenueUsd: num(reports.revenue_usd),
                revenueKes: num(reports.revenue_kes)
            },
            slots: {
                purchases: int(slots.purchases),
                slotsSold: int(slots.slots_sold),
                revenueUsd: num(slots.revenue_usd),
                revenueKes: num(slots.revenue_kes)
            },
            quickpay: {
                paidInvoices: int(quickpay.paid_invoices),
                revenueUsd: num(quickpay.revenue_usd),
                revenueKes: num(quickpay.revenue_kes)
            },
            assignments: {
                total: int(assignments.total),
                completed: int(assignments.completed),
                revenueUsd: num(assignments.revenue_usd)
            },
            totals: { orders: totalOrders, revenueUsd, revenueKes }
        });
    } catch (error) {
        console.error('Admin overview error:', error);
        res.status(500).json({ error: 'Failed to load admin overview' });
    }
});

// Get all users in the system (client members, quickpay guests, and staff).
// Slot balances are real for everyone — staff are not exempt; only owner accounts are.
router.get('/admin/list', authenticateOwner, async (req, res) => {
    try {
        // 1. Registered Client Members
        const membersResult = await pool.query(`
            SELECT
                id, email, name, phone, membership_tier, discount_percent,
                total_orders, total_spent, is_verified, status, turnitin_wallet_credits, created_at
            FROM client_members
            ORDER BY created_at DESC
        `);

        // 2. QuickPay Clients who don't have a registered member account
        const quickpayResult = await pool.query(`
            SELECT
                q.id, q.email, q.name, q.client_code, q.is_verified, q.status, q.created_at,
                COALESCE(SUM(i.amount), 0) AS total_spent,
                COUNT(i.id) AS total_orders
            FROM quickpay_clients q
            LEFT JOIN quickpay_invoices i ON q.client_code = i.client_code AND i.payment_status = 'paid'
            WHERE LOWER(q.email) NOT IN (SELECT LOWER(email) FROM client_members WHERE email IS NOT NULL)
            GROUP BY q.id, q.email, q.name, q.client_code, q.is_verified, q.status, q.created_at
            ORDER BY q.created_at DESC
        `);

        // 3. Staff / Admin Users. Their slot balance lives on the matching client_members row
        //    (created lazily the first time slots are granted), so LEFT JOIN it in.
        const staffResult = await pool.query(`
            SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
                   COALESCE(cm.turnitin_wallet_credits, 0) AS turnitin_wallet_credits
            FROM users u
            LEFT JOIN client_members cm ON LOWER(cm.email) = LOWER(u.email)
            ORDER BY u.created_at DESC
        `);

        const members = membersResult.rows
            // Owner accounts are listed separately below via the staff/owner path; keep them
            // out of the manageable-member list so nobody tries to dock the owner's slots.
            .map(m => ({
                id: m.id,
                email: m.email,
                name: m.name || m.email.split('@')[0],
                phone: m.phone || '',
                tier: m.membership_tier || 'basic',
                discount: parseFloat(m.discount_percent || 0),
                orders: parseInt(m.total_orders || 0),
                totalSpent: parseFloat(m.total_spent || 0),
                verified: m.is_verified,
                status: m.status || 'active',
                scanCredits: parseInt(m.turnitin_wallet_credits || 0),
                unlimited: isOwnerEmail(m.email),
                userType: isOwnerEmail(m.email) ? 'Owner' : 'Registered Member',
                joinedAt: m.created_at
            }));

        const quickpayUsers = quickpayResult.rows.map(q => ({
            id: `qp_${q.id}`,
            email: q.email,
            name: q.name || q.client_code,
            phone: '',
            tier: 'QuickPay Guest',
            discount: 0,
            orders: parseInt(q.total_orders || 0),
            totalSpent: parseFloat(q.total_spent || 0),
            verified: q.is_verified,
            status: q.status || 'active',
            scanCredits: 0,
            unlimited: false,
            userType: 'QuickPay Guest',
            joinedAt: q.created_at
        }));

        // Staff who also hold a member account are already in `members` — skip the duplicate row.
        const memberEmails = new Set(members.map(m => (m.email || '').toLowerCase()));
        const staffUsers = staffResult.rows
            .filter(s => !memberEmails.has((s.email || '').toLowerCase()))
            .map(s => ({
                id: `staff_${s.id}`,
                email: s.email,
                name: s.name,
                phone: '',
                tier: (s.role || 'staff').toUpperCase(),
                discount: 0,
                orders: 0,
                totalSpent: 0,
                verified: true,
                status: s.status || 'active',
                scanCredits: parseInt(s.turnitin_wallet_credits || 0),
                unlimited: isOwnerEmail(s.email),
                userType: isOwnerEmail(s.email) ? 'Owner' : `Staff (${s.role})`,
                joinedAt: s.created_at
            }));

        const allUsers = [...members, ...quickpayUsers, ...staffUsers];

        const stats = {
            total: allUsers.length,
            registeredMembers: members.length,
            quickpayGuests: quickpayUsers.length,
            staff: staffUsers.length,
            totalSlotsHeld: allUsers.reduce((sum, u) => sum + (u.unlimited ? 0 : u.scanCredits), 0)
        };

        res.json({ members: allUsers, stats });
    } catch (error) {
        console.error('Get members list error:', error);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

// Resolves an email to a client_members row, creating one on the fly for QuickPay guests and
// staff so slots can be granted to anyone in the system, not just registered members.
async function resolveSlotAccount(emailLower) {
    const existing = await pool.query(
        'SELECT id, email, name, turnitin_wallet_credits FROM client_members WHERE LOWER(email) = $1',
        [emailLower]
    );
    if (existing.rows.length > 0) return existing.rows[0];

    const qpRes = await pool.query('SELECT name FROM quickpay_clients WHERE LOWER(email) = $1', [emailLower]);
    if (qpRes.rows.length > 0) {
        const created = await pool.query(`
            INSERT INTO client_members (email, name, password_hash, is_verified, turnitin_wallet_credits)
            VALUES ($1, $2, 'quickpay-guest-no-password', TRUE, 0)
            RETURNING id, email, name, turnitin_wallet_credits
        `, [emailLower, qpRes.rows[0].name]);
        return created.rows[0];
    }

    const staffRes = await pool.query('SELECT name FROM users WHERE LOWER(email) = $1', [emailLower]);
    if (staffRes.rows.length > 0) {
        const created = await pool.query(`
            INSERT INTO client_members (email, name, password_hash, is_verified, turnitin_wallet_credits)
            VALUES ($1, $2, 'staff-account-no-password', TRUE, 0)
            RETURNING id, email, name, turnitin_wallet_credits
        `, [emailLower, staffRes.rows[0].name]);
        return created.rows[0];
    }

    return null;
}

async function writeSlotChange(member, newCredits, delta, actorEmail) {
    const message = delta > 0
        ? `${delta} report check slot(s) were added to your account.`
        : `${Math.abs(delta)} report check slot(s) were removed from your account. You now have ${newCredits}.`;

    await pool.query(
        `INSERT INTO member_notifications (member_id, title, message, type)
         VALUES ($1, $2, $3, $4)`,
        [member.id, delta > 0 ? 'Report Slots Added' : 'Report Slots Adjusted', message, delta > 0 ? 'success' : 'info']
    );

    try {
        await pool.query(
            `INSERT INTO slot_adjustments (member_id, email, delta, new_balance, adjusted_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [member.id, member.email, delta, newCredits, actorEmail || 'admin']
        );
    } catch (e) {
        // Audit log is best-effort — never block the adjustment itself on it.
        console.error('Slot adjustment audit write failed:', e.message);
    }
}

// Add or remove slots by a relative amount
router.post('/admin/adjust-credits', authenticateOwner, async (req, res) => {
    try {
        const { email, delta } = req.body;
        const amount = Number(delta);
        if (!email || !Number.isFinite(amount) || amount === 0) {
            return res.status(400).json({ error: 'Email and a non-zero delta are required' });
        }

        const emailLower = email.toLowerCase().trim();
        const member = await resolveSlotAccount(emailLower);
        if (!member) return res.status(404).json({ error: 'User not found in the system' });

        const updateRes = await pool.query(`
            UPDATE client_members
            SET turnitin_wallet_credits = GREATEST(0, turnitin_wallet_credits + $1)
            WHERE id = $2
            RETURNING turnitin_wallet_credits
        `, [Math.trunc(amount), member.id]);

        const newCredits = parseInt(updateRes.rows[0].turnitin_wallet_credits, 10);
        await writeSlotChange(member, newCredits, Math.trunc(amount), req.owner.email);

        res.json({ success: true, email: emailLower, newCredits });
    } catch (error) {
        console.error('Adjust credits error:', error);
        res.status(500).json({ error: 'Failed to adjust report slots' });
    }
});

// Set a user's slot balance to an exact number
router.post('/admin/set-credits', authenticateOwner, async (req, res) => {
    try {
        const { email, credits } = req.body;
        const target = Number(credits);
        if (!email || !Number.isFinite(target) || target < 0) {
            return res.status(400).json({ error: 'Email and a slot count of 0 or more are required' });
        }

        const emailLower = email.toLowerCase().trim();
        const member = await resolveSlotAccount(emailLower);
        if (!member) return res.status(404).json({ error: 'User not found in the system' });

        const previous = parseInt(member.turnitin_wallet_credits || 0, 10);
        const updateRes = await pool.query(
            'UPDATE client_members SET turnitin_wallet_credits = $1 WHERE id = $2 RETURNING turnitin_wallet_credits',
            [Math.trunc(target), member.id]
        );

        const newCredits = parseInt(updateRes.rows[0].turnitin_wallet_credits, 10);
        if (newCredits !== previous) {
            await writeSlotChange(member, newCredits, newCredits - previous, req.owner.email);
        }

        res.json({ success: true, email: emailLower, newCredits });
    } catch (error) {
        console.error('Set credits error:', error);
        res.status(500).json({ error: 'Failed to set report slots' });
    }
});

// Drill-down for a single user: every report check they've run, by the name of the file they
// uploaded, so a stuck one can be spotted and recovered without hunting through a global list.
router.get('/admin/user-reports', authenticateOwner, async (req, res) => {
    try {
        const email = (req.query.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'email query parameter is required' });

        const memberRes = await pool.query(
            'SELECT id, name, email, turnitin_wallet_credits, total_orders, total_spent FROM client_members WHERE LOWER(email) = $1',
            [email]
        );

        if (memberRes.rows.length === 0) {
            return res.json({ member: null, reports: [], summary: { total: 0, processing: 0, completed: 0, refunded: 0 } });
        }

        const member = memberRes.rows[0];
        const reportsRes = await pool.query(
            `SELECT id, original_filename, status, similarity_score, ai_score,
                    similarity_report_url, ai_report_url, writenix_reference,
                    amount_charged, currency, used_wallet_credit, created_at, completed_at
             FROM writenix_reports
             WHERE member_id = $1
             ORDER BY created_at DESC`,
            [member.id]
        );

        const reports = reportsRes.rows.map(r => ({
            id: r.id,
            filename: r.original_filename,
            status: r.status,
            similarityScore: r.similarity_score,
            aiScore: r.ai_score,
            hasSimilarityReport: !!r.similarity_report_url,
            hasAiReport: !!r.ai_report_url,
            writenixReference: r.writenix_reference,
            amount: r.amount_charged ? parseFloat(r.amount_charged) : 0,
            currency: r.currency || null,
            paidWith: r.used_wallet_credit ? 'slot' : (r.amount_charged ? 'cash' : 'free'),
            createdAt: r.created_at,
            completedAt: r.completed_at
        }));

        res.json({
            member: {
                id: member.id,
                name: member.name,
                email: member.email,
                slots: parseInt(member.turnitin_wallet_credits || 0, 10),
                unlimited: isOwnerEmail(member.email),
                totalOrders: parseInt(member.total_orders || 0, 10),
                totalSpent: parseFloat(member.total_spent || 0)
            },
            reports,
            summary: {
                total: reports.length,
                processing: reports.filter(r => r.status === 'processing').length,
                completed: reports.filter(r => r.status === 'completed').length,
                refunded: reports.filter(r => r.status === 'refunded').length
            }
        });
    } catch (error) {
        console.error('Admin user-reports error:', error);
        res.status(500).json({ error: 'Failed to load user reports' });
    }
});

// Every purchase across every channel, for the admin panel's purchases view.
router.get('/admin/purchases', authenticateOwner, async (req, res) => {
    try {
        const rows = [];
        const push = (r) => rows.push(r);

        const run = async (sql) => {
            try {
                return (await pool.query(sql)).rows;
            } catch (e) {
                return [];
            }
        };

        (await run(`
            SELECT wr.id, wr.original_filename, wr.status, wr.amount_charged, wr.currency,
                   wr.paystack_reference, wr.used_wallet_credit, wr.writenix_reference,
                   wr.created_at, cm.email, cm.name
            FROM writenix_reports wr
            LEFT JOIN client_members cm ON wr.member_id = cm.id
            ORDER BY wr.created_at DESC
        `)).forEach(r => push({
            id: `wnx_${r.id}`,
            type: 'plagiarism_check',
            type_label: 'Report Check',
            icon: 'fa-shield-halved',
            title: r.original_filename,
            client: r.name || r.email || 'Unknown',
            client_email: r.email || '',
            reference: r.writenix_reference ? `WNX-${r.writenix_reference}` : `WNX-${r.id}`,
            payment_reference: r.paystack_reference || (r.used_wallet_credit ? 'Slot' : 'N/A'),
            amount: parseFloat(r.amount_charged || 0),
            currency: r.currency || 'USD',
            paid_with: r.used_wallet_credit ? 'slot' : (r.amount_charged ? 'cash' : 'free'),
            status: r.status,
            date: r.created_at
        }));

        (await run(`
            SELECT sp.id, sp.slot_count, sp.amount, sp.currency, sp.paystack_reference,
                   sp.created_at, cm.email, cm.name
            FROM slot_purchases sp
            LEFT JOIN client_members cm ON sp.member_id = cm.id
            ORDER BY sp.created_at DESC
        `)).forEach(r => push({
            id: `slot_${r.id}`,
            type: 'slot_purchase',
            type_label: 'Slot Bundle',
            icon: 'fa-layer-group',
            title: `${r.slot_count} report slots`,
            client: r.name || r.email || 'Unknown',
            client_email: r.email || '',
            reference: `SLOT-${r.id}`,
            payment_reference: r.paystack_reference || 'N/A',
            amount: parseFloat(r.amount || 0),
            currency: r.currency || 'USD',
            paid_with: 'cash',
            status: 'paid',
            date: r.created_at
        }));

        (await run(`
            SELECT id, invoice_number, client_email, client_name, work_paid_for, amount, currency,
                   payment_status, paystack_reference, created_at, paid_at
            FROM quickpay_invoices
            ORDER BY created_at DESC
        `)).forEach(r => push({
            id: `qp_${r.id}`,
            type: 'quickpay_invoice',
            type_label: 'QuickPay Invoice',
            icon: 'fa-receipt',
            title: r.work_paid_for || `Invoice ${r.invoice_number}`,
            client: r.client_name || r.client_email || 'Unknown',
            client_email: r.client_email || '',
            reference: r.invoice_number,
            payment_reference: r.paystack_reference || 'N/A',
            amount: parseFloat(r.amount || 0),
            currency: r.currency || 'KES',
            paid_with: 'cash',
            status: r.payment_status,
            date: r.paid_at || r.created_at
        }));

        // Homework orders come from client_orders — that's the table that carries the member
        // link, order number and price. `assignments` has no client_id/order_number columns.
        (await run(`
            SELECT co.id, co.order_number, co.final_price, co.payment_status, co.created_at, co.paid_at,
                   co.guest_email, co.guest_name, a.title, cm.email, cm.name
            FROM client_orders co
            LEFT JOIN client_members cm ON co.member_id = cm.id
            LEFT JOIN assignments a ON co.assignment_id = a.id
            ORDER BY co.created_at DESC
        `)).forEach(r => push({
            id: `ord_${r.id}`,
            type: 'assignment_order',
            type_label: 'Homework Order',
            icon: 'fa-file-invoice',
            title: r.title || r.order_number || `HW-${r.id}`,
            client: r.name || r.guest_name || r.email || r.guest_email || 'Guest',
            client_email: r.email || r.guest_email || '',
            reference: r.order_number || `HW-${r.id}`,
            payment_reference: 'Gateway',
            amount: parseFloat(r.final_price || 0),
            currency: 'USD',
            paid_with: 'cash',
            status: r.payment_status || 'pending',
            date: r.paid_at || r.created_at
        }));

        rows.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json({ success: true, count: rows.length, purchases: rows });
    } catch (error) {
        console.error('Admin purchases error:', error);
        res.status(500).json({ error: 'Failed to fetch purchases' });
    }
});

module.exports = router;
module.exports.updateMemberStats = updateMemberStats;
module.exports.authenticateOwner = authenticateOwner;

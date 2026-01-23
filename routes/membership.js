const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const crypto = require('crypto');

// ============ PUBLIC ENDPOINTS ============

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
        
        // Check if already registered
        const existing = await pool.query(
            'SELECT id FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered. Please login instead.' });
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        // Create member
        const result = await pool.query(`
            INSERT INTO client_members (email, name, phone, password_hash, verification_token)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, email, name, membership_tier, discount_percent, created_at
        `, [emailLower, name, phone || null, passwordHash, verificationToken]);
        
        const member = result.rows[0];
        
        // TODO: Send verification email
        // For now, auto-verify
        await pool.query('UPDATE client_members SET is_verified = TRUE WHERE id = $1', [member.id]);
        
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
                discount: parseFloat(member.discount_percent)
            },
            message: 'Registration successful! Welcome to HomeworkPal membership.'
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
        
        res.json({
            success: true,
            token,
            member: {
                id: member.id,
                email: member.email,
                name: member.name,
                tier: member.membership_tier,
                discount: parseFloat(member.discount_percent),
                totalOrders: member.total_orders,
                totalSpent: parseFloat(member.total_spent || 0)
            }
        });
    } catch (error) {
        console.error('Member login error:', error);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

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
            id: member.id,
            email: member.email,
            name: member.name,
            phone: member.phone,
            tier: member.membership_tier,
            discount: parseFloat(member.discount_percent),
            totalOrders: member.total_orders,
            totalSpent: parseFloat(member.total_spent || 0),
            perks: member.perks ? member.perks.split(', ') : [],
            memberSince: member.created_at,
            nextTier: nextTier.rows[0] ? {
                name: nextTier.rows[0].name,
                ordersNeeded: nextTier.rows[0].min_orders - member.total_orders,
                spentNeeded: parseFloat(nextTier.rows[0].min_spent) - parseFloat(member.total_spent || 0),
                discount: parseFloat(nextTier.rows[0].discount_percent)
            } : null
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Update member stats (called after order completion - internal use)
router.post('/update-stats', async (req, res) => {
    try {
        const { email, orderAmount } = req.body;
        
        if (!email) {
            return res.json({ updated: false });
        }
        
        const emailLower = email.toLowerCase().trim();
        
        // Get current member
        const member = await pool.query(
            'SELECT * FROM client_members WHERE email = $1',
            [emailLower]
        );
        
        if (member.rows.length === 0) {
            return res.json({ updated: false, reason: 'Not a member' });
        }
        
        const m = member.rows[0];
        const newOrderCount = m.total_orders + 1;
        const newTotalSpent = parseFloat(m.total_spent || 0) + parseFloat(orderAmount || 0);
        
        // Check for tier upgrade
        const newTier = await pool.query(`
            SELECT * FROM membership_tiers
            WHERE min_orders <= $1 AND min_spent <= $2
            ORDER BY discount_percent DESC
            LIMIT 1
        `, [newOrderCount, newTotalSpent]);
        
        const tierName = newTier.rows[0]?.name || 'basic';
        const discount = newTier.rows[0]?.discount_percent || 5;
        
        // Update member
        await pool.query(`
            UPDATE client_members
            SET total_orders = $1, total_spent = $2, membership_tier = $3, discount_percent = $4
            WHERE id = $5
        `, [newOrderCount, newTotalSpent, tierName, discount, m.id]);
        
        const upgraded = tierName !== m.membership_tier;
        
        res.json({
            updated: true,
            newTier: tierName,
            newDiscount: parseFloat(discount),
            upgraded,
            totalOrders: newOrderCount,
            totalSpent: newTotalSpent
        });
    } catch (error) {
        console.error('Update member stats error:', error);
        res.status(500).json({ error: 'Failed to update stats' });
    }
});

// Get member discount for an email (used during checkout)
router.get('/discount/:email', async (req, res) => {
    try {
        const emailLower = req.params.email.toLowerCase().trim();
        
        const result = await pool.query(
            'SELECT discount_percent, membership_tier FROM client_members WHERE email = $1 AND status = $2',
            [emailLower, 'active']
        );
        
        if (result.rows.length === 0) {
            return res.json({ isMember: false, discount: 0 });
        }
        
        res.json({
            isMember: true,
            tier: result.rows[0].membership_tier,
            discount: parseFloat(result.rows[0].discount_percent)
        });
    } catch (error) {
        console.error('Get discount error:', error);
        res.json({ isMember: false, discount: 0 });
    }
});

module.exports = router;

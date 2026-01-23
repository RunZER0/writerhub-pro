const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const crypto = require('crypto');

// Generate a unique referral code
function generateReferralCode(name) {
    const cleanName = name.replace(/[^a-zA-Z]/g, '').toUpperCase().substring(0, 4);
    const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${cleanName}${randomPart}`;
}

// ============ PUBLIC ENDPOINTS (for clients) ============

// Get or create referral code for a client (by email)
router.post('/code', async (req, res) => {
    try {
        const { email, name } = req.body;
        
        if (!email || !name) {
            return res.status(400).json({ error: 'Email and name required' });
        }

        const emailLower = email.toLowerCase().trim();
        
        // Check if client already has a referral code
        const existing = await pool.query(
            'SELECT * FROM referral_codes WHERE client_email = $1',
            [emailLower]
        );

        if (existing.rows.length > 0) {
            return res.json({
                code: existing.rows[0].code,
                referralLink: `${process.env.BASE_URL || 'https://homeworkpal.pro'}/order?ref=${existing.rows[0].code}`,
                stats: {
                    totalReferrals: existing.rows[0].total_referrals,
                    totalCredits: parseFloat(existing.rows[0].total_credits_earned) || 0
                }
            });
        }

        // Generate new unique code
        let code = generateReferralCode(name);
        let attempts = 0;
        while (attempts < 5) {
            const check = await pool.query('SELECT id FROM referral_codes WHERE code = $1', [code]);
            if (check.rows.length === 0) break;
            code = generateReferralCode(name);
            attempts++;
        }

        // Create new referral code
        const result = await pool.query(
            `INSERT INTO referral_codes (code, client_email, client_name)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [code, emailLower, name]
        );

        res.json({
            code: result.rows[0].code,
            referralLink: `${process.env.BASE_URL || 'https://homeworkpal.pro'}/order?ref=${result.rows[0].code}`,
            stats: {
                totalReferrals: 0,
                totalCredits: 0
            }
        });
    } catch (error) {
        console.error('Error creating referral code:', error);
        res.status(500).json({ error: 'Failed to create referral code' });
    }
});

// Validate a referral code (used when new client arrives via referral link)
router.get('/validate/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        const result = await pool.query(
            'SELECT code, client_name FROM referral_codes WHERE code = $1 AND is_active = TRUE',
            [code.toUpperCase()]
        );

        if (result.rows.length === 0) {
            return res.json({ valid: false });
        }

        res.json({
            valid: true,
            referrerName: result.rows[0].client_name,
            discount: '10%' // Show what discount they'll get
        });
    } catch (error) {
        console.error('Error validating referral code:', error);
        res.status(500).json({ error: 'Failed to validate code' });
    }
});

// Get referral stats for a client (by email)
router.get('/stats/:email', async (req, res) => {
    try {
        const email = req.params.email.toLowerCase().trim();

        // Get referral code info
        const codeResult = await pool.query(
            'SELECT * FROM referral_codes WHERE client_email = $1',
            [email]
        );

        if (codeResult.rows.length === 0) {
            return res.json({ 
                hasCode: false,
                message: 'No referral code found. Submit your first order to get one!'
            });
        }

        const codeData = codeResult.rows[0];

        // Get referral details
        const referrals = await pool.query(
            `SELECT cr.*, a.title as assignment_title, a.amount as assignment_amount
             FROM client_referrals cr
             LEFT JOIN assignments a ON cr.assignment_id = a.id
             WHERE cr.referrer_email = $1
             ORDER BY cr.created_at DESC`,
            [email]
        );

        // Get available credits
        const credits = await pool.query(
            `SELECT * FROM client_credits 
             WHERE client_email = $1 AND is_used = FALSE
             ORDER BY created_at DESC`,
            [email]
        );

        const totalAvailableCredits = credits.rows.reduce((sum, c) => sum + parseFloat(c.amount), 0);

        res.json({
            hasCode: true,
            code: codeData.code,
            referralLink: `${process.env.BASE_URL || 'https://homeworkpal.pro'}/order?ref=${codeData.code}`,
            stats: {
                totalReferrals: codeData.total_referrals,
                totalCreditsEarned: parseFloat(codeData.total_credits_earned) || 0,
                availableCredits: totalAvailableCredits,
                pendingReferrals: referrals.rows.filter(r => r.status === 'pending').length,
                convertedReferrals: referrals.rows.filter(r => r.status === 'converted').length
            },
            referrals: referrals.rows.map(r => ({
                id: r.id,
                referredName: r.referred_name || 'Anonymous',
                status: r.status,
                creditAmount: parseFloat(r.credit_amount) || 0,
                createdAt: r.created_at,
                convertedAt: r.converted_at
            })),
            credits: credits.rows.map(c => ({
                id: c.id,
                amount: parseFloat(c.amount),
                type: c.type,
                description: c.description,
                createdAt: c.created_at
            }))
        });
    } catch (error) {
        console.error('Error getting referral stats:', error);
        res.status(500).json({ error: 'Failed to get referral stats' });
    }
});

// Track a referral when someone uses a code (called when assignment submitted)
router.post('/track', async (req, res) => {
    try {
        const { referralCode, referredEmail, referredName, assignmentId } = req.body;

        if (!referralCode || !referredEmail) {
            return res.status(400).json({ error: 'Referral code and email required' });
        }

        const code = referralCode.toUpperCase().trim();
        const emailLower = referredEmail.toLowerCase().trim();

        // Get the referral code info
        const codeResult = await pool.query(
            'SELECT * FROM referral_codes WHERE code = $1 AND is_active = TRUE',
            [code]
        );

        if (codeResult.rows.length === 0) {
            return res.json({ tracked: false, reason: 'Invalid referral code' });
        }

        const referrerData = codeResult.rows[0];

        // Can't refer yourself
        if (referrerData.client_email === emailLower) {
            return res.json({ tracked: false, reason: 'Cannot use your own referral code' });
        }

        // Check if this client was already referred
        const existingReferral = await pool.query(
            'SELECT id FROM client_referrals WHERE referred_email = $1',
            [emailLower]
        );

        if (existingReferral.rows.length > 0) {
            return res.json({ tracked: false, reason: 'Client already referred' });
        }

        // Create the referral record
        const referral = await pool.query(
            `INSERT INTO client_referrals (referral_code_id, referrer_email, referred_email, referred_name, assignment_id, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             RETURNING *`,
            [referrerData.id, referrerData.client_email, emailLower, referredName, assignmentId]
        );

        // Update referral code stats
        await pool.query(
            'UPDATE referral_codes SET total_referrals = total_referrals + 1 WHERE id = $1',
            [referrerData.id]
        );

        res.json({
            tracked: true,
            referralId: referral.rows[0].id,
            referrerName: referrerData.client_name
        });
    } catch (error) {
        console.error('Error tracking referral:', error);
        res.status(500).json({ error: 'Failed to track referral' });
    }
});

// Convert referral and award credits (called when assignment is marked as paid/completed)
router.post('/convert/:referralId', async (req, res) => {
    try {
        const { referralId } = req.params;
        const { assignmentAmount } = req.body;

        const referral = await pool.query(
            'SELECT * FROM client_referrals WHERE id = $1 AND status = $2',
            [referralId, 'pending']
        );

        if (referral.rows.length === 0) {
            return res.json({ converted: false, reason: 'Referral not found or already converted' });
        }

        const ref = referral.rows[0];

        // Calculate credit amounts (10% of order value for both parties, min $5, max $25)
        const baseAmount = parseFloat(assignmentAmount) || 50;
        let creditAmount = Math.min(Math.max(baseAmount * 0.10, 5), 25);

        // Update referral as converted
        await pool.query(
            `UPDATE client_referrals 
             SET status = 'converted', credit_amount = $1, converted_at = NOW()
             WHERE id = $2`,
            [creditAmount, referralId]
        );

        // Award credit to referrer
        await pool.query(
            `INSERT INTO client_credits (client_email, amount, type, description, referral_id)
             VALUES ($1, $2, 'referral_bonus', $3, $4)`,
            [ref.referrer_email, creditAmount, `Referral bonus for ${ref.referred_name || 'a friend'}`, referralId]
        );

        // Update referral code total credits
        await pool.query(
            `UPDATE referral_codes 
             SET total_credits_earned = total_credits_earned + $1
             WHERE client_email = $2`,
            [creditAmount, ref.referrer_email]
        );

        // Optionally: Award welcome credit to referred client too (two-way reward)
        const welcomeCredit = Math.min(creditAmount, 10); // Max $10 welcome credit
        await pool.query(
            `INSERT INTO client_credits (client_email, amount, type, description, referral_id)
             VALUES ($1, $2, 'welcome_bonus', 'Welcome bonus for being referred!', $3)`,
            [ref.referred_email, welcomeCredit, referralId]
        );

        res.json({
            converted: true,
            referrerCredit: creditAmount,
            referredCredit: welcomeCredit
        });
    } catch (error) {
        console.error('Error converting referral:', error);
        res.status(500).json({ error: 'Failed to convert referral' });
    }
});

// Apply credit to an assignment (reduce amount owed)
router.post('/apply-credit', async (req, res) => {
    try {
        const { clientEmail, assignmentId, creditAmount } = req.body;

        if (!clientEmail || !assignmentId) {
            return res.status(400).json({ error: 'Client email and assignment ID required' });
        }

        const emailLower = clientEmail.toLowerCase().trim();

        // Get available credits
        const credits = await pool.query(
            `SELECT * FROM client_credits 
             WHERE client_email = $1 AND is_used = FALSE
             ORDER BY created_at ASC`,
            [emailLower]
        );

        const totalAvailable = credits.rows.reduce((sum, c) => sum + parseFloat(c.amount), 0);
        const amountToApply = Math.min(parseFloat(creditAmount) || totalAvailable, totalAvailable);

        if (amountToApply <= 0) {
            return res.json({ applied: false, reason: 'No credits available' });
        }

        // Mark credits as used (FIFO)
        let remaining = amountToApply;
        for (const credit of credits.rows) {
            if (remaining <= 0) break;
            
            const creditVal = parseFloat(credit.amount);
            if (remaining >= creditVal) {
                await pool.query(
                    'UPDATE client_credits SET is_used = TRUE, used_at = NOW(), assignment_id = $1 WHERE id = $2',
                    [assignmentId, credit.id]
                );
                remaining -= creditVal;
            }
        }

        // Update assignment with credit applied
        await pool.query(
            'UPDATE assignments SET credit_applied = $1 WHERE id = $2',
            [amountToApply, assignmentId]
        );

        res.json({
            applied: true,
            amountApplied: amountToApply,
            remainingCredits: totalAvailable - amountToApply
        });
    } catch (error) {
        console.error('Error applying credit:', error);
        res.status(500).json({ error: 'Failed to apply credit' });
    }
});

// ============ ADMIN ENDPOINTS ============

// Get all referral statistics (admin overview)
router.get('/admin/overview', async (req, res) => {
    try {
        // Total stats
        const stats = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM referral_codes) as total_codes,
                (SELECT COUNT(*) FROM client_referrals) as total_referrals,
                (SELECT COUNT(*) FROM client_referrals WHERE status = 'converted') as converted_referrals,
                (SELECT COALESCE(SUM(amount), 0) FROM client_credits) as total_credits_issued,
                (SELECT COALESCE(SUM(amount), 0) FROM client_credits WHERE is_used = TRUE) as total_credits_used
        `);

        // Top referrers
        const topReferrers = await pool.query(`
            SELECT 
                rc.client_name,
                rc.client_email,
                rc.code,
                rc.total_referrals,
                rc.total_credits_earned
            FROM referral_codes rc
            ORDER BY rc.total_referrals DESC
            LIMIT 10
        `);

        // Recent referrals
        const recentReferrals = await pool.query(`
            SELECT 
                cr.*,
                rc.client_name as referrer_name,
                rc.code as referral_code
            FROM client_referrals cr
            JOIN referral_codes rc ON cr.referral_code_id = rc.id
            ORDER BY cr.created_at DESC
            LIMIT 20
        `);

        res.json({
            stats: stats.rows[0],
            topReferrers: topReferrers.rows,
            recentReferrals: recentReferrals.rows
        });
    } catch (error) {
        console.error('Error getting admin overview:', error);
        res.status(500).json({ error: 'Failed to get overview' });
    }
});

// Get all referral codes (admin)
router.get('/admin/codes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT rc.*,
                   (SELECT COUNT(*) FROM client_referrals WHERE referral_code_id = rc.id) as referral_count
            FROM referral_codes rc
            ORDER BY rc.created_at DESC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Error getting referral codes:', error);
        res.status(500).json({ error: 'Failed to get codes' });
    }
});

// Manually create a referral code (admin)
router.post('/admin/create-code', async (req, res) => {
    try {
        const { email, name, customCode } = req.body;

        if (!email || !name) {
            return res.status(400).json({ error: 'Email and name required' });
        }

        const emailLower = email.toLowerCase().trim();

        // Check if already exists
        const existing = await pool.query(
            'SELECT * FROM referral_codes WHERE client_email = $1',
            [emailLower]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Client already has a referral code' });
        }

        const code = customCode?.toUpperCase() || generateReferralCode(name);

        const result = await pool.query(
            `INSERT INTO referral_codes (code, client_email, client_name)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [code, emailLower, name]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating referral code:', error);
        res.status(500).json({ error: 'Failed to create code' });
    }
});

// Toggle referral code active status (admin)
router.put('/admin/code/:id/toggle', async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE referral_codes SET is_active = NOT is_active WHERE id = $1 RETURNING *',
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Code not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error toggling code:', error);
        res.status(500).json({ error: 'Failed to toggle code' });
    }
});

// Manually add credit to a client (admin)
router.post('/admin/add-credit', async (req, res) => {
    try {
        const { email, amount, description } = req.body;

        if (!email || !amount) {
            return res.status(400).json({ error: 'Email and amount required' });
        }

        const result = await pool.query(
            `INSERT INTO client_credits (client_email, amount, type, description)
             VALUES ($1, $2, 'manual', $3)
             RETURNING *`,
            [email.toLowerCase().trim(), parseFloat(amount), description || 'Manual credit from admin']
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error adding credit:', error);
        res.status(500).json({ error: 'Failed to add credit' });
    }
});

module.exports = router;

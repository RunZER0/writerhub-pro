const jwt = require('jsonwebtoken');
const db = require('../db');

// Verify JWT token
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database
        const result = await db.query(
            'SELECT id, email, name, role, status FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        if (result.rows[0].status !== 'active') {
            return res.status(403).json({ error: 'Account is inactive' });
        }

        req.user = result.rows[0];
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
};

// Check if user is admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Check if user is admin or accessing own data
const isAdminOrSelf = (req, res, next) => {
    const requestedId = parseInt(req.params.id);
    if (req.user.role !== 'admin' && req.user.id !== requestedId) {
        return res.status(403).json({ error: 'Access denied' });
    }
    next();
};

module.exports = { authenticate, isAdmin, isAdminOrSelf };

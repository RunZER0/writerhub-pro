require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth');
const writerRoutes = require('./routes/writers');
const assignmentRoutes = require('./routes/assignments');
const paymentRoutes = require('./routes/payments');
const dashboardRoutes = require('./routes/dashboard');
const filesRoutes = require('./routes/files');
const messagesRoutes = require('./routes/messages');
const pushRoutes = require('./routes/push');
const telegramRoutes = require('./routes/telegram');
const clientRoutes = require('./routes/client');
const accountingRoutes = require('./routes/accounting');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve landing page at root (BEFORE static middleware)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Serve client portal
app.get('/client', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// Serve writers app
app.get('/writers', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Static files (after explicit routes)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/writers', writerRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/telegram/webhook', telegramRoutes); // Public webhook endpoint
app.use('/api/client', clientRoutes);
app.use('/api/accounting', accountingRoutes);

// Serve frontend for all other routes (SPA fallback)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
const { pool } = require('./db');

// Auto-run essential migrations on startup
async function runMigrations() {
    try {
        // Telegram link codes table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS telegram_link_codes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                code VARCHAR(10) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // Telegram columns on users
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(50),
            ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100),
            ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMP
        `);
        
        // Submission tracking columns
        await pool.query(`
            ALTER TABLE assignments
            ADD COLUMN IF NOT EXISTS submission_links TEXT,
            ADD COLUMN IF NOT EXISTS submission_notes TEXT,
            ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS client_source VARCHAR(50) DEFAULT 'admin',
            ADD COLUMN IF NOT EXISTS files TEXT,
            ADD COLUMN IF NOT EXISTS domain VARCHAR(100)
        `);

        // Add link column to notifications table
        await pool.query(`
            ALTER TABLE notifications
            ADD COLUMN IF NOT EXISTS link VARCHAR(255)
        `);

        // Add push_subscription to users table
        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS push_subscription TEXT
        `);
        
        console.log('✅ Database migrations complete');
    } catch (error) {
        console.error('⚠️ Migration warning:', error.message);
    }
}

app.listen(PORT, async () => {
    console.log(`🚀 HomeworkPal running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    await runMigrations();
});

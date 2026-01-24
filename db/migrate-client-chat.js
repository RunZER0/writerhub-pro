require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    const client = await pool.connect();
    
    try {
        console.log('Starting client-writer chat migration...');
        
        // Create client_messages table for writer-client communication
        await client.query(`
            CREATE TABLE IF NOT EXISTS client_messages (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
                sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('writer', 'client', 'admin', 'system')),
                sender_id INTEGER,
                message TEXT NOT NULL,
                file_url TEXT,
                file_name VARCHAR(255),
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Created client_messages table');
        
        // Create indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_client_messages_assignment 
            ON client_messages(assignment_id)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_client_messages_unread 
            ON client_messages(assignment_id, sender_type, is_read) 
            WHERE is_read = FALSE
        `);
        console.log('✓ Created indexes');
        
        // Add client_chat_enabled flag to assignments
        await client.query(`
            ALTER TABLE assignments 
            ADD COLUMN IF NOT EXISTS client_chat_enabled BOOLEAN DEFAULT FALSE
        `);
        
        // Add client_last_seen to track when client last viewed messages
        await client.query(`
            ALTER TABLE assignments 
            ADD COLUMN IF NOT EXISTS client_last_seen TIMESTAMP
        `);
        
        // Add writer_last_seen for tracking
        await client.query(`
            ALTER TABLE assignments 
            ADD COLUMN IF NOT EXISTS writer_last_seen_client_chat TIMESTAMP
        `);
        
        console.log('✓ Added chat tracking columns to assignments');
        
        // Create email notification log to prevent spam
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_email_notifications (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
                recipient_type VARCHAR(20) NOT NULL,
                recipient_email VARCHAR(255) NOT NULL,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sent_date DATE DEFAULT CURRENT_DATE
            )
        `);
        
        // Create unique index on date to limit 1 email per day per recipient per assignment
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_email_daily_limit
            ON chat_email_notifications(assignment_id, recipient_type, sent_date)
        `);
        console.log('✓ Created chat_email_notifications table');
        
        console.log('\n✅ Client-writer chat migration completed successfully!');
        
    } catch (error) {
        console.error('Migration error:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(console.error);

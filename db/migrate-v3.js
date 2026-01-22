require('dotenv').config();
const { pool } = require('./index');

const migrate = async () => {
    try {
        console.log('🔄 Running V3 migrations (Job Board, Chat, Files)...');

        // Add job picking fields to assignments
        try {
            await pool.query(`
                ALTER TABLE assignments 
                ADD COLUMN picked_at TIMESTAMP DEFAULT NULL,
                ADD COLUMN writer_deadline TIMESTAMP DEFAULT NULL,
                ADD COLUMN extension_requested BOOLEAN DEFAULT FALSE,
                ADD COLUMN extension_reason TEXT DEFAULT NULL,
                ADD COLUMN ineligible_writers INTEGER[] DEFAULT '{}'
            `);
            console.log('✅ Added job picking columns to assignments');
        } catch (e) {
            if (e.code === '42701') {
                console.log('ℹ️  Job picking columns already exist');
            } else {
                throw e;
            }
        }

        // Add last_seen to users for online status
        try {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ADD COLUMN is_online BOOLEAN DEFAULT FALSE
            `);
            console.log('✅ Added online status columns to users');
        } catch (e) {
            if (e.code === '42701') {
                console.log('ℹ️  Online status columns already exist');
            } else {
                throw e;
            }
        }

        // Create files table for uploads
        await pool.query(`
            CREATE TABLE IF NOT EXISTS files (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
                uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                filename VARCHAR(255) NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                file_type VARCHAR(100) NOT NULL,
                file_size INTEGER NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                upload_type VARCHAR(50) NOT NULL, -- 'instructions' or 'submission'
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Files table created');

        // Create messages table for chat
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                receiver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                message TEXT NOT NULL,
                read_at TIMESTAMP DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Messages table created');

        // Create extension_requests table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS extension_requests (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
                writer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                requested_deadline TIMESTAMP NOT NULL,
                reason TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
                admin_response TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                responded_at TIMESTAMP DEFAULT NULL
            )
        `);
        console.log('✅ Extension requests table created');

        // Create index for faster message queries
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_assignment ON messages(assignment_id);
            CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
            CREATE INDEX IF NOT EXISTS idx_files_assignment ON files(assignment_id);
        `);
        console.log('✅ Indexes created');

        console.log('🎉 V3 Migrations complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    }
};

migrate();

// Migration: Turnitin/Writenix Plagiarism & AI Report Checker
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    const client = await pool.connect();

    try {
        console.log('🔄 Running migration - Turnitin/Writenix Report Checker...');

        // Wallet credits for auto-refunded checks (report.refunded / API failures)
        await client.query(`
            ALTER TABLE client_members
            ADD COLUMN IF NOT EXISTS turnitin_wallet_credits INTEGER DEFAULT 0
        `);
        console.log('✅ Added turnitin_wallet_credits to client_members');

        await client.query(`
            CREATE TABLE IF NOT EXISTS writenix_reports (
                id SERIAL PRIMARY KEY,
                member_id INTEGER REFERENCES client_members(id) ON DELETE CASCADE,
                original_filename VARCHAR(255) NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                status VARCHAR(30) DEFAULT 'processing',
                writenix_reference VARCHAR(255),
                report_url TEXT,
                similarity_score DECIMAL(5,2),
                ai_score DECIMAL(5,2),
                amount_charged DECIMAL(10,2),
                currency VARCHAR(10),
                paystack_reference VARCHAR(100),
                used_wallet_credit BOOLEAN DEFAULT FALSE,
                webhook_payload JSONB,
                created_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            )
        `);
        console.log('✅ Created writenix_reports table');

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_writenix_reports_member ON writenix_reports(member_id);
            CREATE INDEX IF NOT EXISTS idx_writenix_reports_reference ON writenix_reports(writenix_reference);
            CREATE INDEX IF NOT EXISTS idx_writenix_reports_paystack_ref ON writenix_reports(paystack_reference);
        `);
        console.log('✅ Created indexes');

        // Client-facing in-app notifications (mirrors the staff `notifications` table,
        // but scoped to client_members since that table's user_id references the staff `users` table)
        await client.query(`
            CREATE TABLE IF NOT EXISTS member_notifications (
                id SERIAL PRIMARY KEY,
                member_id INTEGER REFERENCES client_members(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'info',
                link VARCHAR(255),
                read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ Created member_notifications table');

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_member_notifications_member ON member_notifications(member_id);
        `);
        console.log('✅ Created member_notifications index');

        console.log('✅ Turnitin/Writenix migration complete!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(() => process.exit(1));

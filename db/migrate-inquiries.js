// Migration: Client Inquiries Chat System & Performance Reports
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    const client = await pool.connect();

    try {
        console.log('🔄 Running migration - Client Inquiries & Reports...');

        // Create client_inquiries table for chat-based inquiry system
        await client.query(`
            CREATE TABLE IF NOT EXISTS client_inquiries (
                id SERIAL PRIMARY KEY,
                member_id INTEGER REFERENCES client_members(id) ON DELETE SET NULL,
                guest_email VARCHAR(255),
                guest_name VARCHAR(255),
                subject VARCHAR(100) NOT NULL,
                status VARCHAR(50) DEFAULT 'open',
                assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                assigned_at TIMESTAMP,
                ticket_number VARCHAR(50) UNIQUE,
                priority VARCHAR(20) DEFAULT 'normal',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                closed_at TIMESTAMP
            )
        `);
        console.log('✅ Created client_inquiries table');

        // Create inquiry_messages table for chat messages
        await client.query(`
            CREATE TABLE IF NOT EXISTS inquiry_messages (
                id SERIAL PRIMARY KEY,
                inquiry_id INTEGER REFERENCES client_inquiries(id) ON DELETE CASCADE,
                sender_type VARCHAR(20) NOT NULL,
                sender_id INTEGER,
                sender_name VARCHAR(255),
                message TEXT NOT NULL,
                is_system_message BOOLEAN DEFAULT FALSE,
                read_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Created inquiry_messages table');

        // Create performance_reports table
        await client.query(`
            CREATE TABLE IF NOT EXISTS performance_reports (
                id SERIAL PRIMARY KEY,
                report_type VARCHAR(50) NOT NULL,
                report_period_start DATE NOT NULL,
                report_period_end DATE NOT NULL,
                data JSONB NOT NULL,
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                generated_by INTEGER REFERENCES users(id)
            )
        `);
        console.log('✅ Created performance_reports table');

        // Create client_orders table for tracking orders with exact pricing
        await client.query(`
            CREATE TABLE IF NOT EXISTS client_orders (
                id SERIAL PRIMARY KEY,
                order_number VARCHAR(50) UNIQUE,
                assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
                member_id INTEGER REFERENCES client_members(id) ON DELETE SET NULL,
                guest_email VARCHAR(255),
                guest_name VARCHAR(255),
                package_type VARCHAR(50),
                base_price DECIMAL(10,2),
                discount_percent DECIMAL(5,2) DEFAULT 0,
                discount_amount DECIMAL(10,2) DEFAULT 0,
                final_price DECIMAL(10,2),
                pages INTEGER,
                deadline_hours INTEGER,
                urgency_fee DECIMAL(10,2) DEFAULT 0,
                payment_status VARCHAR(50) DEFAULT 'pending',
                payment_method VARCHAR(50),
                payment_reference VARCHAR(255),
                paid_at TIMESTAMP,
                receipt_sent BOOLEAN DEFAULT FALSE,
                receipt_sent_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Created client_orders table');

        // Create indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_inquiries_member ON client_inquiries(member_id);
            CREATE INDEX IF NOT EXISTS idx_inquiries_status ON client_inquiries(status);
            CREATE INDEX IF NOT EXISTS idx_inquiries_admin ON client_inquiries(assigned_admin_id);
            CREATE INDEX IF NOT EXISTS idx_inquiry_messages_inquiry ON inquiry_messages(inquiry_id);
            CREATE INDEX IF NOT EXISTS idx_orders_member ON client_orders(member_id);
            CREATE INDEX IF NOT EXISTS idx_orders_assignment ON client_orders(assignment_id);
        `);
        console.log('✅ Created indexes');

        console.log('✅ Migration complete!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();

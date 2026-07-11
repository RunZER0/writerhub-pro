// Migration: QuickPay Fraud Prevention (Client Code identity + invoices/agreements)
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    const client = await pool.connect();

    try {
        console.log('🔄 Running migration - QuickPay Fraud Prevention...');

        await client.query(`
            CREATE TABLE IF NOT EXISTS quickpay_clients (
                id SERIAL PRIMARY KEY,
                client_code VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                is_verified BOOLEAN DEFAULT FALSE,
                verification_token VARCHAR(255),
                token_expiry TIMESTAMP,
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT NOW(),
                last_used_at TIMESTAMP
            )
        `);
        console.log('✅ Created quickpay_clients table');

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_quickpay_clients_code ON quickpay_clients(client_code);
            CREATE INDEX IF NOT EXISTS idx_quickpay_clients_email ON quickpay_clients(email);
        `);
        console.log('✅ Created quickpay_clients indexes');

        await client.query(`
            CREATE TABLE IF NOT EXISTS quickpay_invoices (
                id SERIAL PRIMARY KEY,
                invoice_number VARCHAR(50) UNIQUE NOT NULL,
                client_code VARCHAR(20) NOT NULL REFERENCES quickpay_clients(client_code),
                client_name VARCHAR(255) NOT NULL,
                client_email VARCHAR(255) NOT NULL,
                work_paid_for TEXT NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                currency VARCHAR(10) NOT NULL,
                agreement_text TEXT NOT NULL,
                agreement_accepted_at TIMESTAMP NOT NULL,
                client_local_time VARCHAR(100),
                client_timezone VARCHAR(100),
                payment_status VARCHAR(30) DEFAULT 'invoice_sent',
                paystack_reference VARCHAR(100),
                paid_at TIMESTAMP,
                ip_address VARCHAR(64),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ Created quickpay_invoices table');

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_quickpay_invoices_code ON quickpay_invoices(client_code);
            CREATE INDEX IF NOT EXISTS idx_quickpay_invoices_number ON quickpay_invoices(invoice_number);
        `);
        console.log('✅ Created quickpay_invoices indexes');

        console.log('✅ QuickPay migration complete!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(() => process.exit(1));

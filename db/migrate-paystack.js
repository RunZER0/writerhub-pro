require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    const client = await pool.connect();
    
    try {
        console.log('Starting Paystack payment migration...');
        
        // Create payment_transactions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS payment_transactions (
                id SERIAL PRIMARY KEY,
                reference VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'NGN',
                status VARCHAR(50) DEFAULT 'pending',
                channel VARCHAR(50),
                gateway_response TEXT,
                paystack_response JSONB,
                metadata JSONB,
                paid_at TIMESTAMP,
                verified_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Created payment_transactions table');
        
        // Create indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_payment_transactions_reference 
            ON payment_transactions(reference)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_payment_transactions_email 
            ON payment_transactions(email)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_payment_transactions_status 
            ON payment_transactions(status)
        `);
        console.log('✓ Created indexes');
        
        // Add payment_reference column to client_orders if not exists
        await client.query(`
            ALTER TABLE client_orders 
            ADD COLUMN IF NOT EXISTS paystack_reference VARCHAR(100)
        `);
        console.log('✓ Added paystack_reference to client_orders');
        
        // Create transfer_recipients table for writer payouts
        await client.query(`
            CREATE TABLE IF NOT EXISTS transfer_recipients (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                recipient_code VARCHAR(100) UNIQUE,
                account_name VARCHAR(255),
                account_number VARCHAR(50),
                bank_code VARCHAR(20),
                bank_name VARCHAR(100),
                currency VARCHAR(10) DEFAULT 'NGN',
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Created transfer_recipients table');
        
        // Create payouts table for tracking writer payments
        await client.query(`
            CREATE TABLE IF NOT EXISTS payouts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                recipient_code VARCHAR(100),
                transfer_code VARCHAR(100) UNIQUE,
                reference VARCHAR(100) UNIQUE,
                amount DECIMAL(12,2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'NGN',
                status VARCHAR(50) DEFAULT 'pending',
                reason TEXT,
                paystack_response JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            )
        `);
        console.log('✓ Created payouts table');
        
        console.log('\n✅ Paystack payment migration completed successfully!');
        
    } catch (error) {
        console.error('Migration error:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(console.error);

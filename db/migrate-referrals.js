// Migration: Client Referral System
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Running migration - Client Referral System...');
    
    // Create referral_codes table - stores unique codes for each client
    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        client_email VARCHAR(255) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        is_active BOOLEAN DEFAULT TRUE,
        total_referrals INTEGER DEFAULT 0,
        total_credits_earned DECIMAL(10,2) DEFAULT 0
      )
    `);
    console.log('✅ Created referral_codes table');
    
    // Create client_referrals table - tracks each referral and rewards
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_referrals (
        id SERIAL PRIMARY KEY,
        referral_code_id INTEGER REFERENCES referral_codes(id),
        referrer_email VARCHAR(255) NOT NULL,
        referred_email VARCHAR(255) NOT NULL,
        referred_name VARCHAR(255),
        assignment_id INTEGER REFERENCES assignments(id),
        status VARCHAR(20) DEFAULT 'pending',
        credit_amount DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        converted_at TIMESTAMP,
        credit_applied_at TIMESTAMP
      )
    `);
    console.log('✅ Created client_referrals table');
    
    // Create client_credits table - tracks credits/discounts available
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_credits (
        id SERIAL PRIMARY KEY,
        client_email VARCHAR(255) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        referral_id INTEGER REFERENCES client_referrals(id),
        assignment_id INTEGER REFERENCES assignments(id),
        created_at TIMESTAMP DEFAULT NOW(),
        used_at TIMESTAMP,
        is_used BOOLEAN DEFAULT FALSE
      )
    `);
    console.log('✅ Created client_credits table');
    
    // Add referral tracking to assignments table
    await client.query(`
      ALTER TABLE assignments 
      ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS credit_applied DECIMAL(10,2) DEFAULT 0
    `);
    console.log('✅ Added referral columns to assignments table');
    
    // Create indexes for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_referral_codes_email ON referral_codes(client_email);
      CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
      CREATE INDEX IF NOT EXISTS idx_client_referrals_referrer ON client_referrals(referrer_email);
      CREATE INDEX IF NOT EXISTS idx_client_referrals_referred ON client_referrals(referred_email);
      CREATE INDEX IF NOT EXISTS idx_client_credits_email ON client_credits(client_email);
    `);
    console.log('✅ Created indexes');
    
    console.log('✅ Client Referral System migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

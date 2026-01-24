// Migration: Long-term Membership System
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Running migration - Long-term Membership System...');
    
    // Create client_members table
    await client.query(`
      CREATE TABLE IF NOT EXISTS client_members (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        password_hash VARCHAR(255) NOT NULL,
        membership_tier VARCHAR(20) DEFAULT 'basic',
        discount_percent DECIMAL(5,2) DEFAULT 5.00,
        total_orders INTEGER DEFAULT 0,
        total_spent DECIMAL(10,2) DEFAULT 0,
        is_verified BOOLEAN DEFAULT FALSE,
        verification_token VARCHAR(255),
        token_expiry TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active'
      )
    `);
    console.log('✅ Created client_members table');
    
    // Add token_expiry column if it doesn't exist (for existing tables)
    await client.query(`
      ALTER TABLE client_members 
      ADD COLUMN IF NOT EXISTS token_expiry TIMESTAMP
    `);
    console.log('✅ Added token_expiry column');
    
    // Create membership_tiers for reference
    await client.query(`
      CREATE TABLE IF NOT EXISTS membership_tiers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        min_orders INTEGER DEFAULT 0,
        min_spent DECIMAL(10,2) DEFAULT 0,
        discount_percent DECIMAL(5,2) NOT NULL,
        perks TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created membership_tiers table');
    
    // Insert default membership tiers
    await client.query(`
      INSERT INTO membership_tiers (name, min_orders, min_spent, discount_percent, perks)
      VALUES 
        ('basic', 0, 0, 5, 'Early access to new services, Priority email support'),
        ('silver', 5, 100, 10, 'All Basic perks plus: Free revision on every order, Dedicated support'),
        ('gold', 15, 500, 15, 'All Silver perks plus: Express delivery priority, Exclusive resources'),
        ('platinum', 30, 1500, 20, 'All Gold perks plus: Personal account manager, Custom pricing')
      ON CONFLICT (name) DO UPDATE SET
        discount_percent = EXCLUDED.discount_percent,
        perks = EXCLUDED.perks
    `);
    console.log('✅ Inserted membership tiers');
    
    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_client_members_email ON client_members(email);
      CREATE INDEX IF NOT EXISTS idx_client_members_tier ON client_members(membership_tier);
    `);
    console.log('✅ Created indexes');
    
    console.log('✅ Long-term Membership System migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

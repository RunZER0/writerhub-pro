// Migration v7: Add Telegram integration
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Running migration v7 - Add Telegram integration...');
    
    // Add telegram_chat_id to users table
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100),
      ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMP
    `);
    console.log('✅ Added Telegram columns to users table');
    
    // Create telegram_link_codes table for linking accounts
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_link_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(20) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Created telegram_link_codes table');
    
    console.log('✅ Migration v7 complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

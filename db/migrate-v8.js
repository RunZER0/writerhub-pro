// Migration v8: Add revision workflow
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Running migration v8 - Add revision workflow...');
    
    // Add revision fields to assignments table
    await client.query(`
      ALTER TABLE assignments 
      ADD COLUMN IF NOT EXISTS revision_requested BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS revision_reason TEXT,
      ADD COLUMN IF NOT EXISTS revision_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_revision_at TIMESTAMP
    `);
    console.log('✅ Added revision columns to assignments table');
    
    console.log('✅ Migration v8 complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

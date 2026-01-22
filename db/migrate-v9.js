// Migration v9: Add submission links and completion tracking
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Running migration v9 - Add submission tracking...');
    
    // Add submission_links to assignments table
    await client.query(`
      ALTER TABLE assignments 
      ADD COLUMN IF NOT EXISTS submission_links TEXT,
      ADD COLUMN IF NOT EXISTS submission_notes TEXT,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP
    `);
    console.log('✅ Added submission columns to assignments table');
    
    // Update existing completed assignments
    await client.query(`
      UPDATE assignments 
      SET completed_at = updated_at 
      WHERE status = 'completed' AND completed_at IS NULL
    `);
    console.log('✅ Updated existing completed assignments');
    
    console.log('✅ Migration v9 complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

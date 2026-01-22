const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function updateAdmins() {
  const client = await pool.connect();
  try {
    // Update existing admin emails
    await client.query("UPDATE users SET email = 'admin@homeworkhub.com' WHERE email = 'admin@writerhub.com'");
    await client.query("UPDATE users SET email = 'admin1@homeworkhub.com' WHERE email = 'admin1@writerhub.com'");
    await client.query("UPDATE users SET email = 'admin2@homeworkhub.com' WHERE email = 'admin2@writerhub.com'");
    
    console.log('✅ Admin emails updated!\n');
    console.log('New login credentials:');
    console.log('──────────────────────────────────────');
    console.log('  📧 admin@homeworkhub.com   🔑 admin');
    console.log('  📧 admin1@homeworkhub.com  🔑 admin1');
    console.log('  📧 admin2@homeworkhub.com  🔑 admin2');
    console.log('──────────────────────────────────────');
  } finally {
    client.release();
    await pool.end();
  }
}

updateAdmins();

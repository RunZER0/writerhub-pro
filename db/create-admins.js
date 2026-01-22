// Script to create multiple admin accounts
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createAdmins() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Creating admin accounts...\n');
    
    // Admin accounts to create
    const admins = [
      { email: 'admin@writerhub.com', password: 'admin', name: 'Admin' },
      { email: 'admin1@writerhub.com', password: 'admin1', name: 'Admin 1' },
      { email: 'admin2@writerhub.com', password: 'admin2', name: 'Admin 2' },
    ];
    
    for (const admin of admins) {
      // Check if admin already exists
      const existing = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [admin.email]
      );
      
      if (existing.rows.length > 0) {
        // Update password
        const hashedPassword = await bcrypt.hash(admin.password, 10);
        await client.query(
          'UPDATE users SET password = $1 WHERE email = $2',
          [hashedPassword, admin.email]
        );
        console.log(`🔄 Updated: ${admin.email} (password: ${admin.password})`);
      } else {
        // Create new admin
        const hashedPassword = await bcrypt.hash(admin.password, 10);
        await client.query(
          `INSERT INTO users (email, password, name, role, status) 
           VALUES ($1, $2, $3, 'admin', 'active')`,
          [admin.email, hashedPassword, admin.name]
        );
        console.log(`✅ Created: ${admin.email} (password: ${admin.password})`);
      }
    }
    
    console.log('\n🎉 Admin accounts ready!\n');
    console.log('Login credentials:');
    console.log('──────────────────────────────────────');
    admins.forEach(a => {
      console.log(`  📧 ${a.email}`);
      console.log(`  🔑 ${a.password}`);
      console.log('');
    });
    console.log('──────────────────────────────────────');
    console.log('⚠️  Change passwords after first login!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

createAdmins();

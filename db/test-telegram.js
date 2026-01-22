require('dotenv').config();
const { pool } = require('./index');

async function test() {
    try {
        // Check if table exists
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'telegram_link_codes'
            )
        `);
        console.log('telegram_link_codes table exists:', tableCheck.rows[0].exists);
        
        // Try to insert a test code
        const crypto = require('crypto');
        const code = crypto.randomBytes(3).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        
        console.log('Testing insert with code:', code);
        
        // Use user ID 1 for test
        await pool.query(
            'INSERT INTO telegram_link_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
            [1, code, expiresAt]
        );
        console.log('✅ Insert successful!');
        
        // Clean up
        await pool.query('DELETE FROM telegram_link_codes WHERE code = $1', [code]);
        console.log('✅ Cleanup successful!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Full error:', error);
    }
    process.exit(0);
}

test();

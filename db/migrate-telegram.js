require('dotenv').config();
const { pool } = require('./index');

async function migrate() {
    try {
        console.log('🔄 Running Telegram migration...');
        
        // Create telegram_link_codes table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS telegram_link_codes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                code VARCHAR(10) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ telegram_link_codes table ready');
        
        // Add telegram columns to users if not exist
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(50),
            ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100),
            ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMP
        `);
        console.log('✅ Users telegram columns ready');
        
        // Add TELEGRAM_BOT_USERNAME to .env.example reminder
        console.log('\n📝 Make sure to set these in your .env:');
        console.log('   TELEGRAM_BOT_TOKEN=your_bot_token');
        console.log('   TELEGRAM_BOT_USERNAME=Writerhub_notify_bot');
        
        console.log('\n✅ Migration complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrate();

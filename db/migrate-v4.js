require('dotenv').config();
const { pool } = require('./index');

const migrate = async () => {
    try {
        console.log('🔄 Adding file columns to messages table...');

        await pool.query(`
            ALTER TABLE messages 
            ADD COLUMN IF NOT EXISTS file_url VARCHAR(500),
            ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
            ADD COLUMN IF NOT EXISTS file_type VARCHAR(100)
        `);
        console.log('✅ File columns added to messages');

        console.log('🎉 Migration complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    }
};

migrate();

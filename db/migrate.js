require('dotenv').config();
const { pool } = require('./index');

const migrate = async () => {
    try {
        console.log('🔄 Running migrations...');
        
        // Add domains column to users
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS domains TEXT DEFAULT ''
        `);
        console.log('✅ Added domains column to users');
        
        // Add domain column to assignments
        await pool.query(`
            ALTER TABLE assignments ADD COLUMN IF NOT EXISTS domain VARCHAR(100) DEFAULT ''
        `);
        console.log('✅ Added domain column to assignments');
        
        console.log('🎉 Migrations complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    }
};

migrate();

require('dotenv').config();
const pool = require('./index');

const migrate = async () => {
    try {
        console.log('🔄 Running migration v6 - Add push subscriptions table...');

        // Create push_subscriptions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, endpoint)
            )
        `);
        console.log('✅ Created push_subscriptions table');

        // Create index for faster lookups
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id 
            ON push_subscriptions(user_id)
        `);
        console.log('✅ Created index on user_id');

        console.log('✅ Migration v6 complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
};

migrate();

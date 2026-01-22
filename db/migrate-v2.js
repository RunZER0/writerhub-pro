require('dotenv').config();
const { pool } = require('./index');

const migrate = async () => {
    try {
        console.log('🔄 Running V2 migrations...');

        // Add submitted_amount to assignments (writer's proposed price)
        try {
            await pool.query(`
                ALTER TABLE assignments 
                ADD COLUMN submitted_amount DECIMAL(10, 2) DEFAULT NULL
            `);
            console.log('✅ Added submitted_amount column to assignments');
        } catch (e) {
            if (e.code === '42701') {
                console.log('ℹ️  submitted_amount column already exists');
            } else {
                throw e;
            }
        }

        // Add amount_approved to assignments (admin approval flag)
        try {
            await pool.query(`
                ALTER TABLE assignments 
                ADD COLUMN amount_approved BOOLEAN DEFAULT FALSE
            `);
            console.log('✅ Added amount_approved column to assignments');
        } catch (e) {
            if (e.code === '42701') {
                console.log('ℹ️  amount_approved column already exists');
            } else {
                throw e;
            }
        }

        // Add must_change_password to users (force password change on first login)
        try {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE
            `);
            console.log('✅ Added must_change_password column to users');
        } catch (e) {
            if (e.code === '42701') {
                console.log('ℹ️  must_change_password column already exists');
            } else {
                throw e;
            }
        }

        // Add password_changed_at to track when password was last changed
        try {
            await pool.query(`
                ALTER TABLE users 
                ADD COLUMN password_changed_at TIMESTAMP DEFAULT NULL
            `);
            console.log('✅ Added password_changed_at column to users');
        } catch (e) {
            if (e.code === '42701') {
                console.log('ℹ️  password_changed_at column already exists');
            } else {
                throw e;
            }
        }

        // Add link column to notifications for clickable actions
        try {
            await pool.query(`
                ALTER TABLE notifications 
                ADD COLUMN link VARCHAR(255) DEFAULT NULL
            `);
            console.log('✅ Added link column to notifications');
        } catch (e) {
            if (e.code === '42701') {
                console.log('ℹ️  link column already exists');
            } else {
                throw e;
            }
        }

        console.log('🎉 V2 Migrations complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    }
};

migrate();

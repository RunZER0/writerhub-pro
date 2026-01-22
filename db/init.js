require('dotenv').config();
const { pool } = require('./index');
const bcrypt = require('bcryptjs');

const initDatabase = async () => {
    try {
        console.log('🔄 Initializing database...');

        // Create users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'writer',
                phone VARCHAR(50),
                rate_per_word DECIMAL(10, 4) DEFAULT 0.01,
                status VARCHAR(50) DEFAULT 'active',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Users table created');

        // Create assignments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS assignments (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                writer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                word_count INTEGER NOT NULL,
                rate DECIMAL(10, 4) NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                deadline DATE NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                payment_status VARCHAR(50) DEFAULT 'unpaid',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Assignments table created');

        // Create payments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id SERIAL PRIMARY KEY,
                writer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                amount DECIMAL(10, 2) NOT NULL,
                payment_date DATE NOT NULL,
                method VARCHAR(50) DEFAULT 'bank-transfer',
                reference VARCHAR(255),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Payments table created');

        // Create notifications table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'info',
                read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Notifications table created');

        // Check if admin exists
        const adminCheck = await pool.query(
            "SELECT * FROM users WHERE role = 'admin' LIMIT 1"
        );

        if (adminCheck.rows.length === 0) {
            // Create default admin user
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO users (email, password, name, role, status) 
                 VALUES ($1, $2, $3, $4, $5)`,
                ['admin@writerhub.com', hashedPassword, 'Admin', 'admin', 'active']
            );
            console.log('✅ Default admin created');
            console.log('   📧 Email: admin@writerhub.com');
            console.log('   🔑 Password: admin123');
            console.log('   ⚠️  Please change the password after first login!');
        }

        console.log('\n🎉 Database initialization complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    }
};

initDatabase();

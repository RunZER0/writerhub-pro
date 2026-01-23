require('dotenv').config();
const { pool } = require('./index');

const migrate = async () => {
    try {
        console.log('🔄 Creating accounting/finances table...');

        // Create assignment_finances table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS assignment_finances (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
                client_paid DECIMAL(10, 2) DEFAULT 0,
                writer_cost DECIMAL(10, 2) DEFAULT 0,
                other_costs DECIMAL(10, 2) DEFAULT 0,
                notes TEXT,
                payment_status VARCHAR(50) DEFAULT 'pending',
                payment_date TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(assignment_id)
            )
        `);
        console.log('✅ assignment_finances table created');

        // Add index for quick lookups
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_finances_assignment_id ON assignment_finances(assignment_id)
        `);
        console.log('✅ Index created');

        // Create a view for easy profit calculation (writers are in users table with role='writer')
        await pool.query(`
            CREATE OR REPLACE VIEW assignment_profit_view AS
            SELECT 
                af.id,
                af.assignment_id,
                a.title,
                a.domain,
                u.name as writer_name,
                af.client_paid,
                af.writer_cost,
                af.other_costs,
                (af.client_paid - af.writer_cost - af.other_costs) as profit,
                af.payment_status,
                af.payment_date,
                af.notes,
                a.status as assignment_status,
                a.created_at as assignment_date
            FROM assignment_finances af
            JOIN assignments a ON af.assignment_id = a.id
            LEFT JOIN users u ON a.writer_id = u.id AND u.role = 'writer'
        `);
        console.log('✅ Profit view created');

        console.log('🎉 Accounting migration complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    }
};

migrate();

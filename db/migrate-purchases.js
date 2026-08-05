require('dotenv').config();
const { pool } = require('./index');

const migrate = async () => {
    try {
        console.log('🔄 Running purchases migration...');

        // Ensure indexes exist for fast client purchases querying
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_writenix_reports_member_id ON writenix_reports(member_id);
            CREATE INDEX IF NOT EXISTS idx_quickpay_invoices_email ON quickpay_invoices(client_email);
            CREATE INDEX IF NOT EXISTS idx_quickpay_invoices_code ON quickpay_invoices(client_code);
        `);
        console.log('✅ Created indexes for purchases lookups');

        console.log('🎉 Purchases migration complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    }
};

migrate();

require('dotenv').config();
const { pool } = require('../db');

async function fix() {
    try {
        const res = await pool.query(
            `UPDATE writenix_reports
             SET status = 'completed',
                 similarity_report_url = $1,
                 ai_report_url = $2,
                 completed_at = NOW()
             WHERE id = 31`,
            [
                'https://app.writenix.com/storage/reports/files/report-1-9012-1785931271.pdf',
                'https://app.writenix.com/storage/reports/files/report-2-9012-1785931271.pdf'
            ]
        );
        console.log('✅ Successfully updated report 31 to completed. Updated rows:', res.rowCount);
        process.exit(0);
    } catch (err) {
        console.error('❌ Error updating report 31:', err);
        process.exit(1);
    }
}

fix();

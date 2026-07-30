// Migration: align writenix_reports with Writenix's actual documented webhook payload shape
// (report.completed sends files.report_1 = similarity report, files.report_2 = AI report —
// two separate downloadable files, not one report_url + numeric score fields as first assumed).
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    const client = await pool.connect();

    try {
        console.log('🔄 Running migration - Writenix report URL columns v2...');

        await client.query(`
            ALTER TABLE writenix_reports
            ADD COLUMN IF NOT EXISTS similarity_report_url TEXT,
            ADD COLUMN IF NOT EXISTS ai_report_url TEXT
        `);
        console.log('✅ Added similarity_report_url and ai_report_url columns');
        console.log('ℹ️  report_url/similarity_score/ai_score columns are kept but no longer written to — superseded by the two columns above');

        console.log('✅ Migration complete!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(() => process.exit(1));

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const res = await pool.query(`
            UPDATE writenix_reports
            SET similarity_score = CAST(webhook_payload->>'plagiarism_score' AS NUMERIC),
                ai_score = CAST(webhook_payload->>'ai_score' AS NUMERIC)
            WHERE webhook_payload IS NOT NULL
              AND status = 'completed'
              AND (similarity_score IS NULL OR ai_score IS NULL)
        `);
        console.log('Updated rows:', res.rowCount);
    } catch(e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();

require('dotenv').config();
const { pool } = require('./index');

const migrate = async () => {
    try {
        console.log('🔄 Running migration v5 - Add links and word count range...');

        // Add links column to assignments
        await pool.query(`
            ALTER TABLE assignments 
            ADD COLUMN IF NOT EXISTS links TEXT
        `);
        console.log('✅ Added links column');

        // Add word_count_min and word_count_max columns
        await pool.query(`
            ALTER TABLE assignments 
            ADD COLUMN IF NOT EXISTS word_count_min INTEGER,
            ADD COLUMN IF NOT EXISTS word_count_max INTEGER
        `);
        console.log('✅ Added word_count_min and word_count_max columns');

        // Copy existing word_count to both min and max for existing records
        await pool.query(`
            UPDATE assignments 
            SET word_count_min = word_count, word_count_max = word_count 
            WHERE word_count_min IS NULL
        `);
        console.log('✅ Migrated existing word_count to range');

        // Remove rate column requirement (we'll keep it for legacy but it's optional now)
        // Rate is no longer needed since amount is set manually
        
        console.log('✅ Migration v5 complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
};

migrate();

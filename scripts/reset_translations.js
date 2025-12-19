require("dotenv").config();
const Knex = require("knex");
const knexConfig = require("../knexfile");
const knex = Knex(knexConfig.development);

async function reset() {
    try {
        console.log("Resetting translations...");

        // Postgres specific raw query for efficiency
        const result = await knex.raw(`
      UPDATE products 
      SET 
        title = metadata->>'original_title',
        title_en = NULL,
        metadata = metadata - 'original_title' - 'original_language'
      WHERE metadata->>'original_title' IS NOT NULL;
    `);

        console.log(`Reset complete. Rows affected: ${result.rowCount}`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

reset();

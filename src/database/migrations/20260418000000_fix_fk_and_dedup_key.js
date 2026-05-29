/**
 * Fix four schema bugs in one shot:
 *   SCH1 — products.category_id is NOT NULL + ON DELETE SET NULL (contradiction).
 *           → allow NULL so SET NULL actually works on category delete.
 *   SCH2 — price_history.currency_id same contradiction.
 *   SCH3 — products.title is varchar(255); can truncate scraped titles.
 *           → promote to TEXT.
 *   SCH4 — unique(provider_id, title) is the wrong dedup key (titles collide across
 *           different products, losing data at sync). Replace with a URL-derived key.
 *           → add unique(provider_id, fetch_url) instead. Keep a plain index on title
 *             for search.
 *
 * This migration is data-safe: it does not DELETE any rows. If the current `(provider_id,
 * title)` unique constraint contains duplicates (which shouldn't, since the v1 sync
 * upserts on that tuple), the migration will fail on its unique-on-fetch_url step —
 * in that case, call the migration after deduplicating manually.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
    // SCH1 — drop NOT NULL on products.category_id
    await knex.raw("ALTER TABLE products ALTER COLUMN category_id DROP NOT NULL");

    // SCH2 — drop NOT NULL on price_history.currency_id
    await knex.raw("ALTER TABLE price_history ALTER COLUMN currency_id DROP NOT NULL");

    // SCH3 — products.title varchar(255) → text
    await knex.raw("ALTER TABLE products ALTER COLUMN title TYPE text");

    // SCH4 — swap the unique key
    // Knex's default unique-constraint naming: products_provider_id_title_unique
    await knex.raw("ALTER TABLE products DROP CONSTRAINT IF EXISTS products_provider_id_title_unique");
    // Create a plain index on title for search lookups (was implicit via unique index).
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS products_provider_id_title_idx ON products (provider_id, title)"
    );
    // Add the correct dedup constraint. Products with matching provider+URL are the same SKU.
    await knex.raw(
        "ALTER TABLE products ADD CONSTRAINT products_provider_id_fetch_url_unique UNIQUE (provider_id, fetch_url)"
    );
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
    await knex.raw("ALTER TABLE products DROP CONSTRAINT IF EXISTS products_provider_id_fetch_url_unique");
    await knex.raw("DROP INDEX IF EXISTS products_provider_id_title_idx");
    await knex.raw(
        "ALTER TABLE products ADD CONSTRAINT products_provider_id_title_unique UNIQUE (provider_id, title)"
    );
    await knex.raw("ALTER TABLE products ALTER COLUMN title TYPE varchar(255)");
    // NOT NULL reinstates cannot safely apply if existing rows are NULL; skip if any.
    const nullCats = await knex("products").whereNull("category_id").count("* as c").first();
    if (Number(nullCats.c) === 0) {
        await knex.raw("ALTER TABLE products ALTER COLUMN category_id SET NOT NULL");
    }
    const nullCur = await knex("price_history").whereNull("currency_id").count("* as c").first();
    if (Number(nullCur.c) === 0) {
        await knex.raw("ALTER TABLE price_history ALTER COLUMN currency_id SET NOT NULL");
    }
};

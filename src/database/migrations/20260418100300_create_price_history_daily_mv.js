/**
 * Task 09: price_history_daily materialized view.
 * Requires CONCURRENTLY refresh, which needs a UNIQUE index.
 */
exports.config = { transaction: false };

exports.up = async function (knex) {
    await knex.raw(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS price_history_daily AS
        SELECT
            product_id,
            date_trunc('day', created_at)::date AS day,
            min(price) AS min_price,
            max(price) AS max_price,
            avg(price)::numeric(18,2) AS avg_price,
            count(*) AS sample_count
        FROM price_history
        GROUP BY product_id, date_trunc('day', created_at)
    `);
    await knex.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS price_history_daily_prod_day_uq ON price_history_daily (product_id, day)`
    );
};

exports.down = async function (knex) {
    await knex.raw("DROP MATERIALIZED VIEW IF EXISTS price_history_daily");
};

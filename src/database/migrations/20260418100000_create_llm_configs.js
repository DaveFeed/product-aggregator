/**
 * Task 02: llm_configs table for hot model swap.
 */
exports.up = async function (knex) {
    await knex.schema.createTable("llm_configs", (table) => {
        table.increments("id").primary();
        table.string("tier").notNullable(); // 'FAST' | 'SMART'
        table.string("provider").notNullable().defaultTo("openai");
        table.string("model").notNullable();
        table.string("base_url");
        table.string("api_key_env"); // env var name, NOT the secret
        table.integer("priority").notNullable().defaultTo(0);
        table.boolean("enabled").notNullable().defaultTo(true);
        table.jsonb("metadata").defaultTo("{}");
        table.timestamps(true, true);
        table.unique(["tier", "priority"]);
    });

    // Seed default configs.
    await knex("llm_configs").insert([
        { tier: "FAST", provider: "openai", model: "gpt-5.4-mini", api_key_env: "OPENAI_API_KEY", priority: 0 },
        { tier: "SMART", provider: "openai", model: "gpt-5.4", api_key_env: "OPENAI_API_KEY", priority: 0 },
    ]);
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("llm_configs");
};

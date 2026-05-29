/**
 * Task 07: conversations table + rename messages → bot_message_log.
 */
exports.up = async function (knex) {
    await knex.raw("CREATE EXTENSION IF NOT EXISTS pgcrypto");

    // Rename existing messages table (bot interaction logging) to free the name.
    await knex.schema.renameTable("messages", "bot_message_log");
    // PostgreSQL does NOT rename constraints on table rename. The old messages_pkey
    // blocks creating a new messages table with the same constraint name.
    await knex.raw("ALTER TABLE bot_message_log RENAME CONSTRAINT messages_pkey TO bot_message_log_pkey");

    // Conversations: one per user session.
    await knex.schema.createTable("conversations", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.integer("user_id").unsigned().references("id").inTable("users").onDelete("CASCADE");
        table.string("state").notNullable().defaultTo("idle");
        table.jsonb("context").notNullable().defaultTo("{}");
        table.timestamps(true, true);
        table.index(["user_id", "updated_at"]);
    });

    // Messages: conversation turns.
    await knex.schema.createTable("messages", (table) => {
        table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
        table.uuid("conversation_id").references("id").inTable("conversations").onDelete("CASCADE");
        table.string("role").notNullable(); // user, assistant, tool, system
        table.text("content");
        table.jsonb("tool_calls");
        table.string("tool_call_id");
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.index(["conversation_id", "created_at"]);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("messages");
    await knex.schema.dropTableIfExists("conversations");
    await knex.schema.renameTable("bot_message_log", "messages");
};

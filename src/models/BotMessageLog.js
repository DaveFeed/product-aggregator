const { Model } = require("objection");

class BotMessageLog extends Model {
    static get tableName() {
        return "bot_message_log";
    }

    static get relationMappings() {
        const User = require("./User");
        return {
            user: {
                relation: Model.BelongsToOneRelation,
                modelClass: User,
                join: {
                    from: "bot_message_log.user_id",
                    to: "users.id",
                },
            },
        };
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["user_id", "type"],
            properties: {
                id: { type: "integer" },
                user_id: { type: "integer" },
                type: { type: "string" },
                text: { type: "string" },
                metadata: { type: "object" },
                created_at: { type: "string" },
                updated_at: { type: "string" },
            },
        };
    }
}

module.exports = BotMessageLog;

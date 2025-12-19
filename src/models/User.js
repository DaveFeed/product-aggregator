const { Model } = require("objection");

class User extends Model {
    static get tableName() {
        return "users";
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["telegram_id"],

            properties: {
                id: { type: "integer" },
                telegram_id: { type: "string" },
                username: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                language_code: { type: "string" },
                is_bot: { type: "boolean" },
                metadata: { type: "object" },
                created_at: { type: "string" },
                updated_at: { type: "string" },
            },
        };
    }

    static get relationMappings() {
        const Message = require("./Message");
        return {
            messages: {
                relation: Model.HasManyRelation,
                modelClass: Message,
                join: {
                    from: "users.id",
                    to: "messages.user_id",
                },
            },
        };
    }
}

module.exports = User;

const { Model } = require("objection");

class Currency extends Model {
    static get tableName() {
        return "currencies";
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["code", "name", "symbol"],

            properties: {
                id: { type: "integer" },
                code: { type: "string" },
                name: { type: "string" },
                symbol: { type: "string" },
                metadata: { type: "object" },
                created_at: { type: "string" },
                updated_at: { type: "string" },
            },
        };
    }
}

module.exports = Currency;

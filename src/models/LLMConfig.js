const { Model } = require("objection");

class LLMConfig extends Model {
    static get tableName() {
        return "llm_configs";
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["tier", "model"],
            properties: {
                id: { type: "integer" },
                tier: { type: "string" },
                provider: { type: "string" },
                model: { type: "string" },
                base_url: { type: ["string", "null"] },
                api_key_env: { type: ["string", "null"] },
                priority: { type: "integer" },
                enabled: { type: "boolean" },
                metadata: { type: "object" },
            },
        };
    }
}

module.exports = LLMConfig;

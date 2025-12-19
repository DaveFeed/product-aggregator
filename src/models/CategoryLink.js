const { Model } = require("objection");

class CategoryLink extends Model {
    static get tableName() {
        return "category_links";
    }

    static get relationMappings() {
        const Provider = require("./Provider");
        const Category = require("./Category");

        return {
            provider: {
                relation: Model.BelongsToOneRelation,
                modelClass: Provider,
                join: {
                    from: "category_links.provider_id",
                    to: "providers.id",
                },
            },
            category: {
                relation: Model.BelongsToOneRelation,
                modelClass: Category,
                join: {
                    from: "category_links.category_id",
                    to: "categories.id",
                },
            },
        };
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["provider_id", "category_id"],

            properties: {
                id: { type: "integer" },
                provider_id: { type: "integer" },
                category_id: { type: "integer" },
                metadata: { type: "object" },
                created_at: { type: "string" },
                updated_at: { type: "string" },
            },
        };
    }
}

module.exports = CategoryLink;

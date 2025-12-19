const { Model } = require("objection");

class Provider extends Model {
    static get tableName() {
        return "providers";
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["name", "display_name", "base_url"],
            properties: {
                id: { type: "integer" },
                name: { type: "string" },
                display_name: { type: "string" },
                description: { type: "string" },
                base_url: { type: "string" },
                order_script: { type: "string" },
                metadata: { type: "object" },
                created_at: { type: "string" },
                updated_at: { type: "string" },
            },
        };
    }

    static get relationMappings() {
        const Product = require("./Product");
        const CategoryLink = require("./CategoryLink");

        return {
            products: {
                relation: Model.HasManyRelation,
                modelClass: Product,
                join: {
                    from: "providers.id",
                    to: "products.provider_id",
                },
            },
            categoryLinks: {
                relation: Model.HasManyRelation,
                modelClass: CategoryLink,
                join: {
                    from: "providers.id",
                    to: "category_links.provider_id",
                },
            },
        };
    }
}

module.exports = Provider;

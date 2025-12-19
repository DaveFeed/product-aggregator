const { Model } = require("objection");

class Product extends Model {
    static get tableName() {
        return "products";
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["provider_id", "title", "fetch_url"],
            properties: {
                id: { type: "integer" },
                provider_id: { type: "integer" },
                category_id: { type: ["integer", "null"] },
                title: { type: "string" },
                description: { type: "string" },
                weight: { type: ["integer", "null"] }, // in grams
                fetch_url: { type: "string" },
                image_url: { type: ["string", "null"] },
                price: { type: ["number", "string", "null"] },
                currency_id: { type: ["integer", "null"] },
                raw_data: { type: ["object", "null"] },
                metadata: { type: "object" },
                created_at: { type: "string" },
                updated_at: { type: "string" },
            },
        };
    }

    static get relationMappings() {
        const Provider = require("./Provider");
        const Category = require("./Category");
        const Currency = require("./Currency");
        const ProductStock = require("./ProductStock");
        const PriceHistory = require("./PriceHistory");

        return {
            provider: {
                relation: Model.BelongsToOneRelation,
                modelClass: Provider,
                join: {
                    from: "products.provider_id",
                    to: "providers.id",
                },
            },
            category: {
                relation: Model.BelongsToOneRelation,
                modelClass: Category,
                join: {
                    from: "products.category_id",
                    to: "categories.id",
                },
            },
            currency: {
                relation: Model.BelongsToOneRelation,
                modelClass: Currency,
                join: {
                    from: "products.currency_id",
                    to: "currencies.id",
                },
            },
            stocks: {
                relation: Model.HasManyRelation,
                modelClass: ProductStock,
                join: {
                    from: "products.id",
                    to: "product_stocks.product_id",
                },
            },
            priceHistory: {
                relation: Model.HasManyRelation,
                modelClass: PriceHistory,
                join: {
                    from: "products.id",
                    to: "price_history.product_id",
                },
            },
        };
    }
}

module.exports = Product;

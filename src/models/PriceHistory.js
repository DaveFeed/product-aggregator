const { Model } = require("objection");

class PriceHistory extends Model {
    static get tableName() {
        return "price_history";
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["product_id", "price", "currency_id"],
            properties: {
                id: { type: "integer" },
                product_id: { type: "integer" },
                price: { type: ["number", "string"] },
                currency_id: { type: "integer" },
                created_at: { type: "string", format: "date-time" },
            },
        };
    }

    static get relationMappings() {
        const Product = require("./Product");
        const Currency = require("./Currency");

        return {
            product: {
                relation: Model.BelongsToOneRelation,
                modelClass: Product,
                join: {
                    from: "price_history.product_id",
                    to: "products.id",
                },
            },
            currency: {
                relation: Model.BelongsToOneRelation,
                modelClass: Currency,
                join: {
                    from: "price_history.currency_id",
                    to: "currencies.id",
                },
            },
        };
    }
}

module.exports = PriceHistory;

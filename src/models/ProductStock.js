const { Model } = require("objection");

class ProductStock extends Model {
    static get tableName() {
        return "product_stocks";
    }

    static get relationMappings() {
        const Product = require("./Product");

        return {
            product: {
                relation: Model.BelongsToOneRelation,
                modelClass: Product,
                join: {
                    from: "product_stocks.product_id",
                    to: "products.id",
                },
            },
        };
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["product_id", "amount"],

            properties: {
                id: { type: "integer" },
                product_id: { type: "integer" },
                amount: { type: "number" },
                metadata: { type: "object" },
                created_at: { type: "string" },
                updated_at: { type: "string" },
            },
        };
    }
}

module.exports = ProductStock;

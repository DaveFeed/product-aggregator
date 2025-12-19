const { Model } = require("objection");

class Category extends Model {
    static get tableName() {
        return "categories";
    }

    static get jsonSchema() {
        return {
            type: "object",
            required: ["name", "display_name"],
            properties: {
                id: { type: "integer" },
                parent_id: { type: ["integer", "null"] },
                name: { type: "string" },
                display_name: { type: "string" },
                description: { type: "string" },
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
                    from: "categories.id",
                    to: "products.category_id",
                },
            },
            categoryLinks: {
                relation: Model.HasManyRelation,
                modelClass: CategoryLink,
                join: {
                    from: "categories.id",
                    to: "category_links.category_id",
                },
            },
            parent: {
                relation: Model.BelongsToOneRelation,
                modelClass: Category,
                join: {
                    from: "categories.parent_id",
                    to: "categories.id",
                },
            },
            children: {
                relation: Model.HasManyRelation,
                modelClass: Category,
                join: {
                    from: "categories.id",
                    to: "categories.parent_id",
                },
            },
        };
    }
}

module.exports = Category;

/**
 * LLM Tool Registry — DynamicStructuredTool instances for LangChain tool calling.
 *
 * Each tool is session-aware and FSM-enforced: if called from a state where
 * it's not in ALLOWED_TOOLS, it returns { ok: false, error } without executing.
 */

const { DynamicStructuredTool } = require("@langchain/core/tools");
const z = require("zod");
const { ALLOWED_TOOLS } = require("../FSM");
const CartService = require("../../services/CartService");
const CheckoutService = require("../../services/CheckoutService");
const EventLogger = require("../../services/EventLogger");

/**
 * Wrap a tool implementation with FSM state guard.
 * Returns JSON string (LangChain tool convention).
 */
function guarded(toolName, session, fn) {
    return async (input) => {
        const allowed = ALLOWED_TOOLS[session.state] || [];
        if (!allowed.includes(toolName)) {
            return JSON.stringify({
                ok: false,
                error: `Tool '${toolName}' not available in current state: ${session.state}`,
            });
        }
        try {
            const result = await fn(input);
            return JSON.stringify(result);
        } catch (err) {
            return JSON.stringify({ ok: false, error: err.message });
        }
    };
}

/**
 * Build all tools bound to the given session.
 * @param {object} session - ConversationSession instance
 * @returns {Object.<string, DynamicStructuredTool>} keyed by tool name
 */
function buildTools(session) {
    const tools = {};

    // --- search_products ---
    tools.search_products = new DynamicStructuredTool({
        name: "search_products",
        description: "Search for products by query with optional price and category filters.",
        schema: z.object({
            query: z.string().describe("Search query text"),
            filters: z.object({
                price_min: z.number().nullable().describe("Minimum price filter"),
                price_max: z.number().nullable().describe("Maximum price filter"),
                category: z.string().nullable().describe("Category name filter"),
                brand: z.string().nullable().describe("Brand name filter"),
            }).optional().describe("Optional search filters"),
        }),
        func: guarded("search_products", session, async (input) => {
            const SearchService = require("../../services/SearchService");
            const filters = {};
            if (input.filters?.price_min) filters.price_min = input.filters.price_min;
            if (input.filters?.price_max) filters.price_max = input.filters.price_max;
            const results = await SearchService.hybridSearch({
                query: input.query,
                filters,
                limit: 10,
            });
            return {
                ok: true,
                results: results.map((r) => ({
                    id: r.id,
                    title: r.title,
                    price: Number(r.price),
                    provider: r.provider_name || "Unknown",
                })),
            };
        }),
    });

    // --- get_product_details ---
    tools.get_product_details = new DynamicStructuredTool({
        name: "get_product_details",
        description: "Get detailed information about a specific product by ID.",
        schema: z.object({
            product_id: z.number().describe("Product ID to look up"),
        }),
        func: guarded("get_product_details", session, async (input) => {
            const Product = require("../../models/Product");
            const product = await Product.query()
                .findById(input.product_id)
                .withGraphFetched("provider");
            if (!product) return { ok: false, error: "Product not found" };
            EventLogger.log({ userId: session.userId, eventType: "view", productId: product.id });
            return {
                ok: true,
                id: product.id,
                title: product.title,
                description: product.canonical_name,
                price: Number(product.price),
                provider: product.provider?.display_name || "Unknown",
                image_url: product.image_url,
                product_url: product.fetch_url,
            };
        }),
    });

    // --- add_to_cart ---
    tools.add_to_cart = new DynamicStructuredTool({
        name: "add_to_cart",
        description: "Add a product to the shopping cart by product ID.",
        schema: z.object({
            product_id: z.number().describe("Product ID to add"),
            quantity: z.number().optional().default(1).describe("Quantity to add"),
        }),
        func: guarded("add_to_cart", session, async (input) => {
            const Product = require("../../models/Product");
            const product = await Product.query()
                .findById(input.product_id)
                .withGraphFetched("provider");
            if (!product) return { ok: false, error: "Product not found" };
            const result = CartService.add(session, {
                product_id: product.id,
                title: product.title,
                price: Number(product.price),
                provider_name: product.provider?.display_name || "Unknown",
            }, input.quantity || 1);
            EventLogger.log({ userId: session.userId, eventType: "add_to_cart", productId: product.id });
            return result;
        }),
    });

    // --- remove_from_cart ---
    tools.remove_from_cart = new DynamicStructuredTool({
        name: "remove_from_cart",
        description: "Remove a product from the shopping cart by product ID.",
        schema: z.object({
            product_id: z.number().describe("Product ID to remove"),
        }),
        func: guarded("remove_from_cart", session, async (input) => {
            const result = CartService.remove(session, input.product_id);
            EventLogger.log({ userId: session.userId, eventType: "remove_from_cart", productId: input.product_id });
            return { ...result, cart_item_count: (session.context.cart || []).length };
        }),
    });

    // --- view_cart ---
    tools.view_cart = new DynamicStructuredTool({
        name: "view_cart",
        description: "View the current shopping cart contents and total.",
        schema: z.object({}),
        func: guarded("view_cart", session, async () => {
            return CartService.view(session);
        }),
    });

    // --- get_price_history ---
    tools.get_price_history = new DynamicStructuredTool({
        name: "get_price_history",
        description: "Get price history for a product over a number of days.",
        schema: z.object({
            product_id: z.number().describe("Product ID"),
            days: z.number().optional().default(30).describe("Number of days of history"),
        }),
        func: guarded("get_price_history", session, async (input) => {
            const knex = require("../../database/connection");
            const cutoff = new Date(Date.now() - (input.days || 30) * 86400000).toISOString();
            // Try materialized view first, fall back to raw table.
            let rows;
            try {
                rows = (await knex("price_history_daily")
                    .where("product_id", input.product_id)
                    .where("day", ">=", cutoff)
                    .orderBy("day", "asc")).map((r) => ({
                    day: r.day,
                    min: Number(r.min_price),
                    max: Number(r.max_price),
                    avg: Number(r.avg_price),
                    sample_count: r.sample_count,
                }));
            } catch {
                rows = (await knex("price_history")
                    .where("product_id", input.product_id)
                    .where("created_at", ">=", cutoff)
                    .select("price", "created_at")
                    .orderBy("created_at", "asc")).map((r) => ({
                    day: r.created_at,
                    min: Number(r.price),
                    max: Number(r.price),
                    avg: Number(r.price),
                    sample_count: 1,
                }));
            }
            return { ok: true, points: rows };
        }),
    });

    // --- get_recommendations ---
    tools.get_recommendations = new DynamicStructuredTool({
        name: "get_recommendations",
        description: "Get product recommendations for the user.",
        schema: z.object({
            count: z.number().optional().default(5).describe("Number of recommendations"),
        }),
        func: guarded("get_recommendations", session, async (input) => {
            const RecommendationService = require("../../services/RecommendationService");
            const result = await RecommendationService.generateFor(session.userId);
            return { ok: true, items: result.items.slice(0, input.count || 5) };
        }),
    });

    // --- initiate_checkout ---
    tools.initiate_checkout = new DynamicStructuredTool({
        name: "initiate_checkout",
        description: "Preview the order before confirmation. Shows cart summary and asks for confirmation.",
        schema: z.object({}),
        func: guarded("initiate_checkout", session, async () => {
            const result = CheckoutService.initiate(session);
            if (result.ok) result.needs_confirmation = true;
            return result;
        }),
    });

    // --- confirm_checkout ---
    tools.confirm_checkout = new DynamicStructuredTool({
        name: "confirm_checkout",
        description: "Confirm or cancel the checkout. Pass confirm=true to place the order.",
        schema: z.object({
            confirm: z.boolean().describe("true to place order, false to cancel"),
        }),
        func: guarded("confirm_checkout", session, async (input) => {
            const result = CheckoutService.confirm(session, input.confirm);
            return { order_id: result.orderId, status: result.status, ...result };
        }),
    });

    return tools;
}

/**
 * Build tools as a flat array for LangChain's bindTools / agent API.
 */
function buildToolsArray(session) {
    return Object.values(buildTools(session));
}

module.exports = { buildTools, buildToolsArray };

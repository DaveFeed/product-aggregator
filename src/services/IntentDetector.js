/**
 * Intent Detector — extracts structured intent from user messages using
 * LangChain's .withStructuredOutput(zodSchema). Uses FAST tier first,
 * escalates to SMART if confidence < 0.7.
 */

const { z } = require("zod");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const LLMRouter = require("./LLMRouter");

// OpenAI structured output (response_format: json_schema) requires every property
// to be listed in `required`. So all fields use .nullable() — never .optional().
const IntentSchema = z.object({
    intent: z.enum([
        "product_search",
        "price_comparison",
        "add_to_cart",
        "remove_from_cart",
        "view_cart",
        "checkout",
        "price_history",
        "get_recommendations",
        "product_details",
        "greet",
        "help",
        "other",
    ]),
    confidence: z.number().min(0).max(1),
    search_query: z.string().nullable(),
    slots: z.object({
        price_max: z.number().nullable(),
        price_min: z.number().nullable(),
        category: z.string().nullable(),
        brand: z.string().nullable(),
        quantity: z.number().nullable(),
        product_id: z.number().nullable(),
    }),
});

const ESCALATION_THRESHOLD = 0.7;

const SYSTEM_PROMPT = `You are a product search assistant. Analyze the user message and determine their intent.

Rules:
- Set confidence honestly (0-1). Use < 0.7 when the message is ambiguous.
- For product_search: extract a cleaned search_query (generic product name) and any price/category/brand slots.
- For greet/help: search_query = null, slots empty.
- For add_to_cart/remove_from_cart/checkout: extract the relevant product_id if mentioned.
- Prices are in Armenian Dram (AMD / ֏). "до 2000 драм" means price_max: 2000.`;

// Map LLM intent names to FSM event names. Returns null for intents that
// don't map to an FSM event (greet, help, other — handled by the chat layer).
const INTENT_TO_EVENT = {
    product_search: "search_products",
    price_comparison: "search_products",
    add_to_cart: "add_to_cart",
    remove_from_cart: "remove_from_cart",
    view_cart: "view_cart",
    checkout: "initiate_checkout",
    price_history: "view_product",
    get_recommendations: null, // handled directly, no FSM transition
    product_details: "view_product",
    greet: null,
    help: null,
    other: null,
};

function mapIntentToEvent(intentName) {
    return INTENT_TO_EVENT[intentName] ?? null;
}

/**
 * Detect intent from a user message with optional conversation context.
 * @param {string} userMessage
 * @param {Array<{role:string,content:string}>} [conversationContext=[]]
 * @returns {Promise<{intent:string, confidence:number, search_query:string|null, slots:object, tier_used:string}>}
 */
async function detectIntent(userMessage, conversationContext = []) {
    // 1. Try FAST tier
    const fastModel = await LLMRouter.getModel("FAST");
    const structured = fastModel.withStructuredOutput(IntentSchema);

    const messages = [new SystemMessage(SYSTEM_PROMPT)];
    // Add recent conversation context (last few turns) for multi-turn understanding.
    for (const msg of conversationContext.slice(-6)) {
        if (msg.role === "user") messages.push(new HumanMessage(msg.content));
        else if (msg.role === "assistant") messages.push(new SystemMessage(msg.content));
    }
    messages.push(new HumanMessage(userMessage));

    let result;
    let tierUsed = "FAST";

    try {
        result = await structured.invoke(messages);
    } catch (e) {
        console.error("[IntentDetector] FAST structured output failed:", e.message);
        // Fallback to manual JSON parse
        return {
            intent: "product_search",
            confidence: 0.3,
            search_query: userMessage,
            slots: {},
            tier_used: "FAST_FALLBACK",
        };
    }

    // 2. Escalate to SMART if low confidence
    if (result.confidence < ESCALATION_THRESHOLD) {
        console.log(
            `[IntentDetector] FAST confidence ${result.confidence} < ${ESCALATION_THRESHOLD}, escalating to SMART`
        );
        try {
            const smartModel = await LLMRouter.getModel("SMART");
            const smartStructured = smartModel.withStructuredOutput(IntentSchema);
            const smartResult = await smartStructured.invoke(messages);
            console.log(
                `[IntentDetector] SMART result: intent=${smartResult.intent} confidence=${smartResult.confidence}`
            );
            result = smartResult;
            tierUsed = "SMART";
        } catch (e) {
            console.error("[IntentDetector] SMART escalation failed:", e.message, "— using FAST result");
        }
    }

    return {
        intent: result.intent,
        confidence: result.confidence,
        search_query: result.search_query,
        slots: result.slots || {},
        tier_used: tierUsed,
    };
}

module.exports = { IntentSchema, detectIntent, mapIntentToEvent };

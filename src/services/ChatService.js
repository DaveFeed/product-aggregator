/**
 * ChatService — unified entry point for both Telegram bot and web chat.
 * Orchestrates: session → intent → action → response → save.
 *
 * This v1 uses direct intent-to-action mapping. The v2 upgrade (Task 18)
 * will replace the action dispatch with LLM tool calling.
 */

const ConversationSession = require("../dialogue/ConversationSession");
const IntentDetector = require("./IntentDetector");
const { ALLOWED_TOOLS, transition: fsmTransition } = require("../dialogue/FSM");
const LLMRouter = require("./LLMRouter");
const CartService = require("./CartService");
const CheckoutService = require("./CheckoutService");
const EventLogger = require("./EventLogger");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");

/**
 * Handle a user message end-to-end.
 * @param {number} userId
 * @param {string} text
 * @param {{ stream?: boolean }} [opts]
 * @returns {Promise<{ text: string, state: string, toolResults?: any, cartSummary?: object }>}
 */
async function handleMessage(userId, text, opts = {}) {
    // 1. Load session
    const session = await ConversationSession.load(userId);
    await session.appendMessage({ role: "user", content: text });

    // 2. Detect intent
    const conversationContext = session.messages.map((m) => ({ role: m.role, content: m.content }));
    const intent = await IntentDetector.detectIntent(text, conversationContext);

    // 3. Map intent → FSM event and attempt transition
    const fsmEvent = IntentDetector.mapIntentToEvent(intent.intent);
    if (fsmEvent) {
        try {
            session.transition(fsmEvent);
        } catch (e) {
            // FSM rejects this transition from the current state — not an error, just inform.
            console.log(`[ChatService] FSM rejected event '${fsmEvent}' from state '${session.state}': ${e.message}`);
        }
    }

    // 4. Execute action based on intent
    let actionResult = null;
    let toolResults = null;

    switch (intent.intent) {
        case "product_search":
        case "price_comparison": {
            const searchQuery = intent.search_query || text;
            const SearchService = require("./SearchService");
            const filters = {};
            if (intent.slots?.price_max) filters.price_max = intent.slots.price_max;
            if (intent.slots?.price_min) filters.price_min = intent.slots.price_min;
            if (intent.slots?.category) filters.category = intent.slots.category;

            toolResults = await SearchService.hybridSearch({ query: searchQuery, filters, limit: 10 });
            EventLogger.log({ userId, eventType: "search", query: searchQuery });
            session.mergeContext({
                lastResults: toolResults.map((r) => r.id),
                lastQuery: searchQuery,
            });
            // Transition to showing_results if search succeeded.
            try { session.transition("results_returned"); } catch (e) { /* already there or wrong state */ }
            actionResult = { type: "search", count: toolResults.length, query: searchQuery };
            break;
        }
        case "add_to_cart": {
            const productId = intent.slots?.product_id;
            if (productId) {
                const Product = require("../models/Product");
                const product = await Product.query().findById(productId).withGraphFetched("provider");
                if (product) {
                    CartService.add(session, {
                        product_id: product.id,
                        title: product.title,
                        price: Number(product.price),
                        provider_name: product.provider?.display_name || "Unknown",
                    }, intent.slots?.quantity || 1);
                    actionResult = { type: "cart_add", product: product.title };
                }
            }
            break;
        }
        case "view_cart": {
            const cart = CartService.view(session);
            actionResult = { type: "cart_view", ...cart };
            break;
        }
        case "remove_from_cart": {
            if (intent.slots?.product_id) {
                CartService.remove(session, intent.slots.product_id);
                actionResult = { type: "cart_remove", product_id: intent.slots.product_id };
            }
            break;
        }
        case "checkout": {
            const summary = CheckoutService.initiate(session);
            actionResult = { type: "checkout_initiate", ...summary };
            break;
        }
        default:
            actionResult = { type: "general" };
            break;
    }

    // 5. Generate response text via LLM
    const tier = intent.confidence < 0.7 || ["checkout_confirm", "cart_review"].includes(session.state)
        ? "SMART"
        : "FAST";
    const chat = await LLMRouter.getModel(tier);

    const systemPrompt = buildSystemPrompt(session, actionResult, toolResults);
    const response = await chat.invoke([
        new SystemMessage(systemPrompt),
        ...conversationContext.slice(-8).map((m) =>
            m.role === "user" ? new HumanMessage(m.content) : new SystemMessage(m.content)
        ),
        new HumanMessage(text),
    ]);

    const responseText = response.content;

    // 6. Save
    await session.appendMessage({ role: "assistant", content: responseText });
    await session.save();

    return {
        text: responseText,
        state: session.state,
        toolResults: toolResults || undefined,
        cartSummary: CartService.view(session),
    };
}

function buildSystemPrompt(session, actionResult, toolResults) {
    let prompt = `You are a helpful shopping assistant for an Armenian product aggregator.
You help users find products, compare prices, and manage their cart.
Current conversation state: ${session.state}.
Cart has ${(session.context.cart || []).length} item(s).`;

    if (actionResult) {
        switch (actionResult.type) {
            case "search":
                if (toolResults && toolResults.length > 0) {
                    const productList = toolResults
                        .slice(0, 5)
                        .map((p, i) => `${i + 1}. ${p.title} — ${p.price} ֏ (${p.provider_name || "Unknown"})`)
                        .join("\n");
                    prompt += `\n\nSearch results for "${actionResult.query}" (${actionResult.count} found):\n${productList}\n\nPresent these results to the user in a friendly way. Mention prices and providers.`;
                } else {
                    prompt += `\n\nNo products found for "${actionResult.query}". Suggest the user try different search terms.`;
                }
                break;
            case "cart_view":
                if (actionResult.items.length === 0) {
                    prompt += "\n\nThe cart is empty. Let the user know.";
                } else {
                    const itemList = actionResult.items
                        .map((i) => `- ${i.title} x${i.quantity} = ${i.price * i.quantity} ֏`)
                        .join("\n");
                    prompt += `\n\nCart contents:\n${itemList}\nTotal: ${actionResult.total} ֏\n\nPresent the cart to the user.`;
                }
                break;
            case "cart_add":
                prompt += `\n\nAdded "${actionResult.product}" to cart. Confirm to the user.`;
                break;
            case "checkout_initiate":
                if (actionResult.ok) {
                    prompt += `\n\nCheckout initiated. ${actionResult.prompt} Ask the user to confirm.`;
                } else {
                    prompt += `\n\n${actionResult.error}`;
                }
                break;
            case "general":
                prompt += "\n\nRespond helpfully to the user's message. If they seem to want products, suggest they search.";
                break;
        }
    }
    return prompt;
}

module.exports = { handleMessage };

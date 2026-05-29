/**
 * ConversationSession — loads, mutates, and persists per-user dialogue state
 * (FSM state, cart, messages) to the `conversations` and `messages` tables.
 */

const { transition: fsmTransition } = require("./FSM");

const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

class ConversationSession {
    constructor({ id, userId, state, context, messages }) {
        this.id = id;
        this.userId = userId;
        this.state = state;
        this.context = context || {};
        this.messages = messages || [];
        this._dirty = false;
    }

    /**
     * Load the user's active conversation (updated within last 24h) or create a new one.
     */
    static async load(userId) {
        const knex = require("../database/connection");
        const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();

        let row = await knex("conversations")
            .where("user_id", userId)
            .where("updated_at", ">=", cutoff)
            .orderBy("updated_at", "desc")
            .first();

        if (!row) {
            const [inserted] = await knex("conversations")
                .insert({ user_id: userId, state: "idle", context: JSON.stringify({}) })
                .returning("*");
            row = inserted;
        }

        // Load last 20 messages in chronological order.
        const msgRows = await knex("messages")
            .where("conversation_id", row.id)
            .orderBy("created_at", "desc")
            .limit(20);
        msgRows.reverse();

        return new ConversationSession({
            id: row.id,
            userId: row.user_id,
            state: row.state,
            context: typeof row.context === "string" ? JSON.parse(row.context) : row.context || {},
            messages: msgRows,
        });
    }

    /**
     * Transition FSM state via an event. Updates in-memory state; call save() to persist.
     */
    transition(event) {
        this.state = fsmTransition(this.state, event);
        this._dirty = true;
        return this.state;
    }

    /**
     * Shallow-merge a patch into context.
     */
    mergeContext(patch) {
        Object.assign(this.context, patch);
        this._dirty = true;
    }

    /**
     * Append a message to the conversation. Persisted immediately to DB.
     */
    async appendMessage({ role, content, toolCalls, toolCallId }) {
        const knex = require("../database/connection");
        const [row] = await knex("messages")
            .insert({
                conversation_id: this.id,
                role,
                content,
                tool_calls: toolCalls ? JSON.stringify(toolCalls) : null,
                tool_call_id: toolCallId || null,
            })
            .returning("*");
        this.messages.push(row);
        return row;
    }

    /**
     * Save state + context to the conversations table.
     */
    async save() {
        const knex = require("../database/connection");
        const updated = await knex("conversations")
            .where("id", this.id)
            .update({
                state: this.state,
                context: JSON.stringify(this.context),
                updated_at: new Date().toISOString(),
            });
        if (updated === 0) {
            // Optimistic lock failure or row deleted — reload and retry once.
            const fresh = await ConversationSession.load(this.userId);
            Object.assign(this, fresh);
            throw new Error("ConversationSession save conflict — reloaded. Retry the operation.");
        }
        this._dirty = false;
    }

    /**
     * Reset to idle. Clears focusedProductId but keeps cart.
     */
    reset() {
        this.state = "idle";
        this.context.focusedProductId = null;
        this.context.lastResults = null;
        this._dirty = true;
    }
}

module.exports = ConversationSession;

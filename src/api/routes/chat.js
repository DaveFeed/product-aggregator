/**
 * SSE Streaming Chat endpoint.
 * POST /api/chat/message — streams LLM response tokens via Server-Sent Events.
 */

const express = require("express");
const router = express.Router();
const { authRequired } = require("../middleware/auth");
const rateLimit = require("express-rate-limit");

// Rate limit: 30 messages/min per user.
const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: "Too many messages, slow down." },
    validate: { xForwardedForHeader: false },
});

router.post("/message", authRequired, chatLimiter, async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ error: "text is required" });
    }

    const userId = req.user.id;

    // Set up SSE headers.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Heartbeat to keep connection alive.
    const heartbeat = setInterval(() => {
        res.write(": ping\n\n");
    }, 15000);

    let closed = false;
    req.on("close", () => {
        closed = true;
        clearInterval(heartbeat);
    });

    try {
        // Use ChatService (non-streaming for now — v1).
        const ChatService = require("../../services/ChatService");
        const result = await ChatService.handleMessage(userId, text.trim());

        if (closed) return;

        // Emit tool results if present.
        if (result.toolResults) {
            res.write(`event: tool_result\ndata: ${JSON.stringify({ tool: "search_products", result: result.toolResults.slice(0, 5) })}\n\n`);
        }

        // Emit text as a single token event (streaming LLM tokens would be v2).
        res.write(`event: token\ndata: ${JSON.stringify({ text: result.text })}\n\n`);

        // Emit done.
        res.write(`event: done\ndata: ${JSON.stringify({ state: result.state, cart_summary: result.cartSummary })}\n\n`);
    } catch (err) {
        if (!closed) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        }
    } finally {
        clearInterval(heartbeat);
        if (!closed) res.end();
    }
});

module.exports = router;

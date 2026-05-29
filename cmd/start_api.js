#!/usr/bin/env node

/**
 * Start the Express API server.
 * Usage: node cmd/start_api.js
 */

require("dotenv").config();

const { createApp } = require("../src/api/index");

const PORT = parseInt(process.env.PORT, 10) || 3000;

const app = createApp();
const server = app.listen(PORT, () => {
    console.log(`[API] Server listening on port ${PORT}`);
});

// Graceful shutdown.
function shutdown() {
    console.log("[API] Shutting down...");
    server.close(() => {
        try {
            const knex = require("../src/database/connection");
            knex.destroy().then(() => process.exit(0));
        } catch {
            process.exit(0);
        }
    });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

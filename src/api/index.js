/**
 * Express API server factory.
 * Construction is separated from .listen() to enable testing.
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const pkg = require("../../package.json");

const WEB_DIST = path.resolve(__dirname, "../../web/dist");

function createApp() {
    const app = express();

    // 1. Security headers.
    app.use(helmet());

    // 2. CORS.
    const origins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : "*";
    app.use(cors({ origin: origins }));

    // 3. JSON body parsing.
    app.use(express.json({ limit: "1mb" }));

    // 4. Request logging via morgan → Winston (if available) or stdout.
    let logStream;
    try {
        const logger = require("../../src/utils/logger");
        logStream = { write: (msg) => logger.info(msg.trim()) };
    } catch {
        logStream = process.stdout;
    }
    app.use(morgan("combined", { stream: logStream }));

    // 5. Rate limit on /api.
    app.use("/api", rateLimit({
        windowMs: 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many requests, please try again later." },
    }));

    // 6. Routes.
    app.get("/api/health", (_req, res) => {
        res.json({ ok: true, version: pkg.version });
    });

    // Mount sub-routers.
    app.use("/api/analytics", require("./routes/analytics"));
    app.use("/api/auth", require("./routes/auth"));
    app.use("/api/chat", require("./routes/chat"));

    // 7. Static SPA (built web/dist). Falls back to index.html for client-side routes.
    if (fs.existsSync(WEB_DIST)) {
        app.use(express.static(WEB_DIST));
        app.get(/^\/(?!api\/).*/, (_req, res) => {
            res.sendFile(path.join(WEB_DIST, "index.html"));
        });
    }

    // 8. 404 handler (API paths and any GETs that fell through when SPA is absent).
    app.use((_req, res) => {
        res.status(404).json({ error: "Not found" });
    });

    // 9. Global error handler.
    app.use((err, _req, res, _next) => {
        const status = err.status || 500;
        if (status >= 500) {
            console.error("[API] Internal error:", err);
        }
        res.status(status).json({
            error: status >= 500 ? "internal" : err.message,
        });
    });

    return app;
}

module.exports = { createApp };

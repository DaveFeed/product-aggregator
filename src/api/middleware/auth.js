/**
 * JWT authentication middleware.
 * Validates Authorization: Bearer <token> and sets req.user = { id }.
 */

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function authRequired(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Authorization required" });
    }

    const token = header.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = { id: payload.sub };
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}

/**
 * Optional auth — sets req.user if token present, but doesn't reject.
 */
function authOptional(req, _res, next) {
    const header = req.headers.authorization;
    if (header && header.startsWith("Bearer ")) {
        try {
            const payload = jwt.verify(header.slice(7), JWT_SECRET);
            req.user = { id: payload.sub };
        } catch {
            // Invalid token — just proceed without user.
        }
    }
    next();
}

/**
 * Sign a JWT for a given user.
 */
function signToken(userId) {
    return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "7d" });
}

module.exports = { authRequired, authOptional, signToken, JWT_SECRET };

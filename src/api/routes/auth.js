/**
 * Auth routes — JWT issuance via Telegram account linking.
 */

const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { signToken } = require("../middleware/auth");

// Alphabet without ambiguous chars (0/O, I/1).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode() {
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    return code;
}

// POST /api/auth/link-code/start — generate a link code.
router.post("/link-code/start", async (req, res, next) => {
    try {
        const knex = require("../../database/connection");
        const code = generateCode();
        await knex("auth_link_codes").insert({ code, user_id: null });
        res.json({ code, expires_in: 600 });
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/link-code/poll — poll for code consumption.
router.post("/link-code/poll", async (req, res, next) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: "code is required" });

        const knex = require("../../database/connection");
        const row = await knex("auth_link_codes").where("code", code).first();

        if (!row) return res.status(404).json({ error: "Code not found" });

        // Check expiry (10 minutes).
        const created = new Date(row.created_at);
        if (Date.now() - created.getTime() > 10 * 60 * 1000) {
            return res.status(410).json({ error: "Code expired" });
        }

        if (row.consumed_at && row.user_id) {
            // Code consumed — issue JWT.
            const token = signToken(row.user_id);
            return res.json({ pending: false, token, user_id: row.user_id });
        }

        res.json({ pending: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

/**
 * LLM Router — selects between FAST and SMART model tiers with optional
 * fallback chains. Uses env-based defaults; supports DB-backed config from
 * llm_configs table when available (Task 02).
 *
 * Usage:
 *   const LLMRouter = require('./LLMRouter');
 *   const model = await LLMRouter.getModel('FAST');
 *   const res = await model.invoke([{role:'user', content:'hello'}]);
 */

require("dotenv").config();
const { ChatOpenAI } = require("@langchain/openai");

const TIERS = Object.freeze({ FAST: "FAST", SMART: "SMART" });

const CACHE_TTL_MS = 60_000; // 60 s

// Default config — used when llm_configs table doesn't exist or is empty.
const ENV_DEFAULTS = {
    [TIERS.FAST]: {
        provider: "openai",
        model: process.env.LLM_FAST_MODEL || "gpt-5.4-mini",
        apiKeyEnv: "OPENAI_API_KEY",
    },
    [TIERS.SMART]: {
        provider: "openai",
        model: process.env.LLM_SMART_MODEL || "gpt-5.4",
        apiKeyEnv: "OPENAI_API_KEY",
    },
};

// Cache: { FAST: { model, expiresAt }, SMART: { model, expiresAt } }
const cache = new Map();

/**
 * Build a LangChain chat model from a config row.
 * Supports OpenAI (native) and Groq (OpenAI-compatible endpoint).
 * Anthropic requires @langchain/anthropic — added as optional fallback only.
 */
function buildModel(cfg) {
    const apiKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
    const opts = {
        model: cfg.model || "gpt-5.4-mini",
        temperature: cfg.temperature ?? 0,
    };

    if (cfg.provider === "groq") {
        return new ChatOpenAI({
            ...opts,
            openAIApiKey: apiKey || process.env.GROQ_API_KEY,
            configuration: { baseURL: cfg.baseUrl || "https://api.groq.com/openai/v1" },
        });
    }

    // Default: OpenAI
    return new ChatOpenAI({
        ...opts,
        openAIApiKey: apiKey || process.env.OPENAI_API_KEY,
        ...(cfg.baseUrl ? { configuration: { baseURL: cfg.baseUrl } } : {}),
    });
}

/**
 * Try to load config from the llm_configs DB table. Returns null if the table
 * doesn't exist or is empty (graceful degradation for Task 02 not yet applied).
 */
async function loadDbConfig() {
    try {
        // Lazy-load to avoid requiring DB connection at module init.
        const knex = require("../database/connection");
        const exists = await knex.schema.hasTable("llm_configs");
        if (!exists) return null;

        const rows = await knex("llm_configs")
            .where({ enabled: true })
            .orderBy("tier")
            .orderBy("priority");
        if (!rows || rows.length === 0) return null;

        const config = {};
        for (const row of rows) {
            const tier = row.tier;
            if (!config[tier]) config[tier] = [];
            config[tier].push({
                provider: row.provider || "openai",
                model: row.model,
                baseUrl: row.base_url || null,
                apiKeyEnv: row.api_key_env || "OPENAI_API_KEY",
                temperature: row.temperature ?? 0,
            });
        }
        return config;
    } catch (e) {
        // DB not available — fall through to env defaults.
        return null;
    }
}

/**
 * Build a model chain (primary + fallbacks) for a given tier.
 */
async function buildTierModel(tier) {
    const dbConfig = await loadDbConfig();

    let configs;
    if (dbConfig && dbConfig[tier] && dbConfig[tier].length > 0) {
        configs = dbConfig[tier];
    } else {
        configs = [ENV_DEFAULTS[tier]];
        // Optional: add Groq as fallback if env key exists.
        if (process.env.GROQ_API_KEY) {
            configs.push({
                provider: "groq",
                model: tier === TIERS.FAST ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile",
                apiKeyEnv: "GROQ_API_KEY",
            });
        }
    }

    const primary = buildModel(configs[0]);
    if (configs.length <= 1) return primary;

    const fallbacks = configs.slice(1).map((c) => buildModel(c));
    return primary.withFallbacks({ fallbacks });
}

/**
 * Get a chat model for the given tier. Cached for CACHE_TTL_MS.
 * @param {'FAST'|'SMART'} tier
 * @returns {Promise<import("@langchain/core/language_models/chat_models").BaseChatModel>}
 */
async function getModel(tier) {
    if (!TIERS[tier]) {
        throw new Error(`Unknown tier '${tier}'. Valid: ${Object.keys(TIERS).join(", ")}`);
    }

    const cached = cache.get(tier);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.model;
    }

    const model = await buildTierModel(tier);
    cache.set(tier, { model, expiresAt: Date.now() + CACHE_TTL_MS });
    return model;
}

function clearCache() {
    cache.clear();
}

function getDefaultConfig() {
    return { ...ENV_DEFAULTS };
}

module.exports = { TIERS, getModel, clearCache, getDefaultConfig };

const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const LLMRouter = require("./LLMRouter");
const EmbeddingService = require("./EmbeddingService");
const Product = require("../models/Product");

class SearchService {
    constructor() {
        // Chat model is loaded lazily via LLMRouter on first use.
        this._chat = null;
        this.embeddings = EmbeddingService;
        this._getChat = async () => {
            if (!this._chat) this._chat = await LLMRouter.getModel("FAST");
            return this._chat;
        };
        this.parsePrice = (p) => {
            if (typeof p === "number") return p;
            return parseFloat(p.replace(/[^0-9.]/g, ""));
        };
    }

    async parseIntent(userQuery) {
        const systemMsg = new SystemMessage(`
        You are a smart shopping assistant parser.
        Extract the search intent from the user's query.
        Return a JSON object with:
        {
            "name": "canonical product name (generic, lowercased, no brands if general)",
            "quantity": number (default 1),
            "unit": "g" | "kg" | "ml" | "l" | "pc" | null,
            "constraints": ["list", "of", "adjectives", "or", "constraints"]
        }
        Do NOT return markdown. Return ONLY JSON.
        Example: "cheap gluten free bread" -> {"name": "bread", "quantity": 1, "unit": null, "constraints": ["cheap", "gluten free"]}
        `);

        const chat = await this._getChat();
        const response = await chat.invoke([systemMsg, new HumanMessage(userQuery)]);

        try {
            const content = response.content
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim();
            return JSON.parse(content);
        } catch (e) {
            console.error("Error parsing intent:", e);
            // Fallback to simple intent
            return { name: userQuery, quantity: 1, unit: null, constraints: [] };
        }
    }

    async fetchCandidates(intent) {
        const { name } = intent;
        const Product = require("../models/Product"); // Lazy load or require at top
        const knex = Product.knex();

        // 1. Vector Search
        const vector = await this.embeddings.embedQuery(name);

        const { rows: vectorRows } = await knex.raw(
            `SELECT id, title, price, fetch_url as product_url, canonical_name,
             (embedding <=> ?::vector) as distance, 'vector' as source
             FROM products 
             WHERE price IS NOT NULL 
             ORDER BY distance ASC 
             LIMIT 20`,
            [JSON.stringify(vector)]
        );

        // 2. Text Search
        const { rows: textRows } = await knex.raw(
            `SELECT id, title, price, fetch_url as product_url, canonical_name,
             0 as distance, 'text' as source
             FROM products 
             WHERE price IS NOT NULL 
             AND to_tsvector('simple', canonical_name) @@ plainto_tsquery('simple', ?)
             ORDER BY price ASC 
             LIMIT 20`,
            [name]
        );

        // Merge
        const all = [...textRows, ...vectorRows];
        const unique = Array.from(new Map(all.map((p) => [p.id, p])).values());

        // Populate provider info for display (optional, but good)
        // We'll hydrate full objects if needed, but for filtering lightweight is better.
        // Let's just return these lightweight rows + provider_id if available.
        // The raw query didn't select provider_id. Let's add it.

        return unique;
    }

    async filterAndRank(intent, candidates) {
        if (candidates.length === 0) return [];

        const candidatesStr = candidates
            .map((c, i) => `${i + 1}. ID:${c.id} | Name: "${c.title}" | Price: ${c.price}`)
            .join("\n");

        const prompt = `
        I need to find products matching:
        Item: "${intent.name}"
        Constraints: ${JSON.stringify(intent.constraints || [])}
        
        Candidates:
        ${candidatesStr}

        Task:
        1. Identify candidates that match the item and constraints.
        2. Rank them by relevance and price (cheaper is better if relevance is equal).
        3. Exclude completely irrelevant items.
        
        Return JSON:
        {
            "matches": [
                { "id": <id>, "reason": "short reason" }
            ]
        }
        Return top 10 matches maximum.
        `;

        const chat = await this._getChat();
        const response = await chat.invoke([
            new SystemMessage("You are a shopping assistant filter."),
            new HumanMessage(prompt),
        ]);

        try {
            const content = response.content
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim();
            const json = JSON.parse(content);

            if (json.matches) {
                // Map back to full candidate objects
                const results = json.matches
                    .map((m) => {
                        const original = candidates.find((c) => c.id === m.id);
                        if (original) return { ...original, match_reason: m.reason };
                        return null;
                    })
                    .filter((x) => x);
                return results;
            }
        } catch (e) {
            console.error("Filter parse error", e);
        }

        // Fallback: return top 5 valid candidates sorted by price if LLM fails
        return candidates.sort((a, b) => this.parsePrice(a.price) - this.parsePrice(b.price)).slice(0, 5);
    }

    async searchWithIntent(intent) {
        const knex = Product.knex();
        const vector = await this.embeddings.embedQuery(intent.name);

        const { rows: vectorRows } = await knex.raw(
            `SELECT products.id,
                    products.title,
                    products.price,
                    products.fetch_url as product_url,
                    products.canonical_name,
                    products.provider_id,
                    (products.embedding <=> ?::vector) as distance,
                    'vector' as source,
                    providers.display_name as provider_name
             FROM products
             LEFT JOIN providers
                ON products.provider_id = providers.id
             WHERE products.price IS NOT NULL 
             ORDER BY distance ASC 
             LIMIT 20`,
            [JSON.stringify(vector)]
        );

        const { rows: textRows } = await knex.raw(
            `SELECT products.id, products.title, products.price, products.fetch_url as product_url, products.canonical_name, products.provider_id,
             0 as distance, 'text' as source,
             providers.display_name as provider_name
             FROM products
             LEFT JOIN providers ON products.provider_id = providers.id
             WHERE products.price IS NOT NULL 
             AND to_tsvector('simple', products.canonical_name) @@ plainto_tsquery('simple', ?)
             ORDER BY products.price ASC 
             LIMIT 20`,
            [intent.name]
        );

        const all = [...textRows, ...vectorRows];
        const unique = Array.from(new Map(all.map((p) => [p.id, p])).values());

        // 3. Filter
        const results = await this.filterAndRank(intent, unique);
        return results;
    }

    /**
     * Hybrid RRF Search (Task 12). Runs vector + trigram search in two CTEs,
     * fuses results via Reciprocal Rank Fusion (k=60), returns top-N products.
     *
     * @param {{ query: string, filters?: object, k?: number, limit?: number }} opts
     * @returns {Promise<Array<object>>} products sorted by rrf_score DESC
     */
    async hybridSearch({ query, filters = {}, k = 60, limit = 20 } = {}) {
        const knex = Product.knex();
        const vector = await this.embeddings.embedQuery(query);
        const vectorStr = JSON.stringify(vector);

        // Validate filter types to prevent SQL injection.
        if (filters.price_min != null) {
            const v = Number(filters.price_min);
            if (isNaN(v)) throw new TypeError("price_min must be numeric");
            filters.price_min = v;
        }
        if (filters.price_max != null) {
            const v = Number(filters.price_max);
            if (isNaN(v)) throw new TypeError("price_max must be numeric");
            filters.price_max = v;
        }

        // Build optional WHERE fragments for filters (identical in both CTEs).
        const whereClauses = [];
        const bindings = [];
        // Recursive category CTE prefix (injected before the main CTEs if needed).
        let categoryCTEPrefix = "";
        const categoryBindings = [];

        if (filters.price_min != null) {
            whereClauses.push(`products.price >= ?`);
            bindings.push(filters.price_min);
        }
        if (filters.price_max != null) {
            whereClauses.push(`products.price <= ?`);
            bindings.push(filters.price_max);
        }
        if (filters.provider_name) {
            const names = Array.isArray(filters.provider_name) ? filters.provider_name : [filters.provider_name];
            whereClauses.push(`products.provider_id IN (SELECT id FROM providers WHERE name = ANY(?))`);
            bindings.push(names);
        }
        if (filters.category_id) {
            const ids = Array.isArray(filters.category_id) ? filters.category_id : [filters.category_id];
            // Recursive CTE to include descendant categories.
            categoryCTEPrefix = `cat_tree AS (
                SELECT id FROM categories WHERE id = ANY(?)
                UNION ALL
                SELECT c.id FROM categories c JOIN cat_tree t ON c.parent_id = t.id
            ),`;
            categoryBindings.push(ids);
            whereClauses.push(`products.category_id IN (SELECT id FROM cat_tree)`);
        }
        if (filters.exclude_product_ids?.length) {
            whereClauses.push(`products.id != ALL(?)`);
            bindings.push(filters.exclude_product_ids);
        }
        const filterSQL = whereClauses.length > 0 ? "AND " + whereClauses.join(" AND ") : "";

        const withKeyword = categoryCTEPrefix ? "WITH RECURSIVE" : "WITH";
        const sql = `
            ${withKeyword} ${categoryCTEPrefix}
            vector_search AS (
                SELECT products.id,
                       ROW_NUMBER() OVER (ORDER BY products.embedding <=> '${vectorStr}'::vector) AS rank
                FROM products
                WHERE products.embedding IS NOT NULL
                  AND products.price IS NOT NULL
                  ${filterSQL.replace(/\?/g, () => "?")}
                ORDER BY products.embedding <=> '${vectorStr}'::vector
                LIMIT 50
            ),
            text_search AS (
                SELECT products.id,
                       ROW_NUMBER() OVER (ORDER BY similarity(products.canonical_name, ?) DESC) AS rank
                FROM products
                WHERE products.canonical_name IS NOT NULL
                  AND products.canonical_name % ?
                  AND products.price IS NOT NULL
                  ${filterSQL.replace(/\?/g, () => "?")}
                ORDER BY similarity(products.canonical_name, ?) DESC
                LIMIT 50
            ),
            rrf AS (
                SELECT COALESCE(v.id, t.id) AS id,
                       COALESCE(1.0 / (${k} + v.rank), 0) + COALESCE(1.0 / (${k} + t.rank), 0) AS rrf_score
                FROM vector_search v
                FULL OUTER JOIN text_search t ON v.id = t.id
            )
            SELECT p.id, p.title, p.price, p.weight, p.image_url,
                   p.fetch_url AS product_url, p.canonical_name,
                   p.provider_id, p.category_id,
                   prov.display_name AS provider_name,
                   rrf.rrf_score
            FROM rrf
            JOIN products p ON p.id = rrf.id
            LEFT JOIN providers prov ON prov.id = p.provider_id
            ORDER BY rrf.rrf_score DESC
            LIMIT ?
        `;

        // Bind order: [cat_tree_bindings..., vector_filter_bindings..., query, query, text_filter_bindings..., query, limit]
        const finalBindings = [
            ...categoryBindings,  // recursive category CTE (if present)
            ...bindings,          // vector CTE filters
            query, query,         // text_search: similarity arg + % operator arg
            ...bindings,          // text CTE filters
            query,                // final similarity ORDER BY arg
            limit,
        ];

        try {
            await knex.raw("SET LOCAL pg_trgm.similarity_threshold = 0.1");
        } catch (e) {
            // If SET LOCAL fails outside a transaction, just proceed.
        }
        const { rows } = await knex.raw(sql, finalBindings);
        return rows;
    }

    async search(query) {
        const intent = await this.parseIntent(query);
        console.log("Parsed Intent:", intent);

        // Use hybrid search instead of the old two-query path.
        const candidates = await this.hybridSearch({
            query: intent.name || query,
            filters: {},
        });

        const results = await this.filterAndRank(intent, candidates);
        return results;
    }
}

module.exports = new SearchService();

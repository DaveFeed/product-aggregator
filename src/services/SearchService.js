const { ChatOpenAI } = require("@langchain/openai");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { Embeddings } = require("@langchain/core/embeddings");
const Product = require("../models/Product");

class XenovaEmbeddings extends Embeddings {
    constructor(config) {
        super(config);
        this.modelName = config?.modelName || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
        this.pipeline = null;
    }

    async init() {
        if (!this.pipeline) {
            const { pipeline } = await import("@xenova/transformers");
            this.pipeline = await pipeline("feature-extraction", this.modelName);
        }
    }

    async embedQuery(document) {
        await this.init();
        const output = await this.pipeline(document, { pooling: "mean", normalize: true });
        return Array.from(output.data);
    }

    async embedDocuments(documents) {
        // Not used for search queries usually, but required by interface
        await this.init();
        return Promise.all(documents.map((d) => this.embedQuery(d)));
    }
}

class SearchService {
    constructor() {
        this.chat = new ChatOpenAI({
            modelName: "gpt-5-mini",
        });
        this.embeddings = new XenovaEmbeddings();
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

        const response = await this.chat.invoke([systemMsg, new HumanMessage(userQuery)]);

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

        const response = await this.chat.invoke([
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

    async search(query) {
        const intent = await this.parseIntent(query);
        console.log("Parsed Intent:", intent);

        return this.searchWithIntent(intent);
    }
}

module.exports = new SearchService();

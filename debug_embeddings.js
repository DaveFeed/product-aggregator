const { Model } = require("objection");
const Knex = require("knex");
const knexConfig = require("./knexfile");
const Product = require("./src/models/Product");

const knex = Knex(knexConfig.development);
Model.knex(knex);

async function run() {
    // 1. Get embedding for "tea"
    const { pipeline } = await import("@xenova/transformers");
    const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    const output = await extractor("tea", { pooling: "mean", normalize: true });
    const queryVec = Array.from(output.data);

    // 2. Fetch specific products from the user's result list
    // "Tea lemon Mac Tea 16g" (id might be tricky, search by title)
    // "Rucola"
    const products = await Product.query()
        .where("title", "like", "%Tea lemon Mac Tea%")
        .orWhere("title", "like", "%Rucola%")
        .orWhere("title", "like", "%wrench%")
        .limit(5);

    console.log(`Found ${products.length} products to check.`);

    function cosineSimilarity(vecA, vecB) {
        let dot = 0;
        let magA = 0;
        let magB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            magA += vecA[i] * vecA[i];
            magB += vecB[i] * vecB[i];
        }
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    // PGVector <=> operator is cosine DISTANCE = 1 - Cosine Similarity
    // So 0.0 is identical, 1.0 is orthogonal, 2.0 is opposite.

    for (const p of products) {
        if (!p.embedding) {
            console.log(`[${p.title}] has NO embedding.`);
            continue;
        }

        // Postgres returns vector as string string format "[0.1, ...]" probably?
        // Or objection might parse it if pg-vector is not set up in objection types?
        // Usually it comes as string from driver if type parser not installed.
        let vec = p.embedding;
        if (typeof vec === "string") {
            vec = JSON.parse(vec.replace("[", "[").replace("]", "]"));
            // actually pg vector output is usually string in format `[1,2,3]` which matches JSON array syntax mostly.
        }

        const sim = cosineSimilarity(queryVec, vec);
        const dist = 1 - sim;

        console.log(`\nProduct: ${p.title}`);
        console.log(`  Embedding Preview: [${vec.slice(0, 5).join(", ")}...]`);
        console.log(`  Manual Cosine Distance: ${dist.toFixed(5)}`);

        // Also check DB distance calculation
        const dbResult = await knex.raw("SELECT embedding <=> ?::vector as dist FROM products WHERE id = ?", [
            JSON.stringify(queryVec),
            p.id,
        ]);
        console.log(`  DB Calculated Distance: ${dbResult.rows[0].dist}`);
    }

    process.exit(0);
}

run();

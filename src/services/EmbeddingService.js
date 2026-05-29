/**
 * EmbeddingService — centralized embedding computation.
 *
 * Current model: paraphrase-multilingual-MiniLM-L12-v2 (384d).
 * Future: Xenova/bge-m3 (1024d) — swap MODEL_NAME and DIMS when Tasks 05+06 are applied.
 *
 * Singleton pipeline; lazy-loaded on first call.
 */

const MODEL_NAME = process.env.EMBEDDING_MODEL || "Xenova/bge-m3";
const DIMS = parseInt(process.env.EMBEDDING_DIMS, 10) || 1024;

let _pipeline = null;

async function init() {
    if (_pipeline) return _pipeline;
    const { pipeline } = await import("@xenova/transformers");
    _pipeline = await pipeline("feature-extraction", MODEL_NAME);
    return _pipeline;
}

/**
 * Embed a query text. Returns Float32Array of length DIMS.
 */
async function embedQuery(text) {
    const pipe = await init();
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

/**
 * Embed a passage/document text. For MiniLM, same as embedQuery.
 * bge-m3 also doesn't need prefix differentiation.
 */
async function embedPassage(text) {
    return embedQuery(text);
}

/**
 * Batch embed multiple texts.
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]>}
 */
async function embedBatch(texts) {
    const pipe = await init();
    const results = [];
    for (const text of texts) {
        const output = await pipe(text, { pooling: "mean", normalize: true });
        results.push(Array.from(output.data));
    }
    return results;
}

/**
 * Format a vector as a pgvector-compatible string: '[0.1,0.2,...]'.
 * @param {Float32Array|number[]} vector
 * @returns {string}
 */
function vectorToPgString(vector) {
    return "[" + Array.from(vector).join(",") + "]";
}

/**
 * Dispose the pipeline to free memory.
 */
async function dispose() {
    _pipeline = null;
}

/**
 * @returns {number} Current embedding dimensions.
 */
function getDims() {
    return DIMS;
}

module.exports = { init, embedQuery, embedPassage, embedBatch, vectorToPgString, dispose, getDims };

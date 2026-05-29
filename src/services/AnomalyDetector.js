/**
 * AnomalyDetector — dual Z-score + IQR anomaly detection for product prices.
 * A price is flagged as anomalous only when BOTH methods agree (AND logic).
 */

function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Analyze a single price against a history array. Pure function, no DB.
 * @param {number} currentPrice
 * @param {number[]} historicalPrices - array of past prices (at least 5 recommended)
 * @returns {{ isAnomaly:boolean, zscore:number, expected_min:number, expected_max:number,
 *             zscoreFlag:boolean, iqrFlag:boolean, method:string|null, insufficient_data:boolean }}
 */
function analyzeFromData(currentPrice, historicalPrices) {
    if (!historicalPrices || historicalPrices.length < 5) {
        return {
            isAnomaly: false,
            zscore: 0,
            expected_min: 0,
            expected_max: 0,
            zscoreFlag: false,
            iqrFlag: false,
            method: null,
            insufficient_data: true,
        };
    }

    const prices = historicalPrices.map(Number).sort((a, b) => a - b);
    const n = prices.length;
    const mean = prices.reduce((a, b) => a + b, 0) / n;
    const stddev = Math.sqrt(prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / n);

    // Z-score test: anomalous if |z| > 3.
    const z = stddev > 0 ? (currentPrice - mean) / stddev : 0;
    const zscoreFlag = Math.abs(z) > 3;

    // IQR test: anomalous if outside [Q1 - 1.5·IQR, Q3 + 1.5·IQR].
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const iqr = q3 - q1;
    const expectedMin = q1 - 1.5 * iqr;
    const expectedMax = q3 + 1.5 * iqr;
    const iqrFlag = currentPrice < expectedMin || currentPrice > expectedMax;

    const isAnomaly = zscoreFlag && iqrFlag;

    return {
        isAnomaly,
        zscore: Math.round(z * 1000) / 1000,
        expected_min: Math.round(expectedMin * 100) / 100,
        expected_max: Math.round(expectedMax * 100) / 100,
        zscoreFlag,
        iqrFlag,
        method: isAnomaly ? "zscore_iqr_and" : null,
        insufficient_data: false,
    };
}

/**
 * Detect anomaly for a single product by ID (requires DB).
 * Reads from price_history_daily MV if available, else raw price_history.
 */
async function detect(productId, windowDays = 30) {
    const Product = require("../models/Product");
    const knex = Product.knex();

    const product = await Product.query().findById(productId);
    if (!product || product.price == null) return null;

    const hasMV = await knex.schema.hasTable("price_history_daily").catch(() => false);
    let rows;
    if (hasMV) {
        rows = await knex("price_history_daily")
            .where("product_id", productId)
            .where("day", ">=", knex.raw(`NOW() - INTERVAL '${parseInt(windowDays, 10)} days'`))
            .select("avg_price");
    } else {
        rows = await knex("price_history")
            .where("product_id", productId)
            .where("created_at", ">=", knex.raw(`NOW() - INTERVAL '${parseInt(windowDays, 10)} days'`))
            .select("price as avg_price");
    }

    const historicalPrices = rows.map((r) => Number(r.avg_price));
    const result = analyzeFromData(Number(product.price), historicalPrices);

    if (result.isAnomaly) {
        // Insert into price_anomalies if table exists and not already recorded.
        const hasTable = await knex.schema.hasTable("price_anomalies").catch(() => false);
        if (hasTable) {
            const exists = await knex("price_anomalies")
                .where({ product_id: productId, anomalous_price: product.price })
                .whereNull("resolved_at")
                .first();
            if (!exists) {
                await knex("price_anomalies").insert({
                    product_id: productId,
                    anomalous_price: product.price,
                    expected_min: result.expected_min,
                    expected_max: result.expected_max,
                    zscore: result.zscore,
                    method: result.method,
                });
            }
        }
    }

    return result;
}

module.exports = { analyzeFromData, detect, percentile };

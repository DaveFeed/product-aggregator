const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.carrefour.am";

function extractUnitFromTitle(title) {
    if (!title) return "";
    const matches = [
        ...title.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|pcs|piece|l|ml|կգ|գ|լ|մլ|հատ|кг|г|л|мл|шт)(?![\p{L}])/gimu),
    ];
    if (matches.length) return matches[matches.length - 1][0];
    if (/\bkg\b/i.test(title)) return "per kg";
    return "";
}

async function scrape() {
    const config = process.env.JOB_CONFIG
        ? JSON.parse(process.env.JOB_CONFIG)
        : { base_url: BASE_URL, output_dir: "./data" };

    const outputDir = path.resolve(config.output_dir || "./data");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const targetCategory = process.argv.find((a) => a.startsWith("--category="));
    const limitArg = process.argv.find((a) => a.startsWith("--limit="));
    const productLimit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

    console.log(`Starting scrape for ${BASE_URL}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    const stats = { productsScraped: 0, productsFailed: 0, priceParseFailed: 0 };

    try {
        console.log(`Navigating to ${BASE_URL}/en...`);
        await page.goto(`${BASE_URL}/en`);
        await page.waitForLoadState("domcontentloaded");

        // Collect all /everyday-products/ links with depth 1 (one path segment after the prefix).
        const hrefs = await page.$$eval("a", (as) => as.map((a) => a.href));
        const categoryUrls = new Set();
        hrefs.forEach((href) => {
            if (!href.includes("/everyday-products/") || href.endsWith(".html")) return;
            const rel = href.split("/everyday-products/")[1]?.replace(/\/$/, "");
            if (rel && !rel.includes("/")) categoryUrls.add(href);
        });

        // Skip navigational buckets that aren't real categories.
        const NAVIGATIONAL = new Set(["promotions", "new-products", "exclusive-assortment"]);

        // For each category, fetch the real display name from the page's <h1>.
        const categories = [];
        for (const url of Array.from(categoryUrls)) {
            const slug = url.split("/").pop();
            if (NAVIGATIONAL.has(slug)) continue;
            let name = slug.replace(/-/g, " ");
            try {
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
                const h1Text = await page.$eval("h1", (h) => h.textContent?.trim()).catch(() => "");
                if (h1Text) name = h1Text;
            } catch (e) {
                console.warn(`  Could not fetch h1 for ${slug}: ${e.message}`);
            }
            categories.push({ url, slug, name });
        }

        console.log(`Found ${categories.length} categories.`);

        let categoriesToScrape = categories;
        if (targetCategory) {
            const wanted = targetCategory.split("=")[1];
            categoriesToScrape = categories.filter((c) => c.name === wanted || c.slug === wanted);
            if (categoriesToScrape.length === 0) {
                console.error(`Category '${wanted}' not found. Available: ${categories.map((c) => c.slug).join(", ")}`);
                return;
            }
        }

        const allProducts = [];
        const seenProductUrls = new Set();

        for (const cat of categoriesToScrape) {
            if (productLimit > 0 && stats.productsScraped >= productLimit) break;
            console.log(`Processing Category: ${cat.name} (${cat.url})`);

            try {
                await page.goto(cat.url);
                await page.waitForLoadState("domcontentloaded");

                let hasNextPage = true;
                let pageNum = 1;

                while (hasNextPage) {
                    if (productLimit > 0 && stats.productsScraped >= productLimit) break;
                    console.log(`  Scraping Page ${pageNum}...`);

                    try {
                        await page.waitForSelector("li.product-item", { timeout: 5000 });
                    } catch (e) {
                        console.log("    No products found on this page.");
                        break;
                    }

                    const items = await page.$$("li.product-item");
                    console.log(`    Found ${items.length} items.`);

                    for (const item of items) {
                        if (productLimit > 0 && stats.productsScraped >= productLimit) break;
                        try {
                            const titleEl = await item.$("a.product-item-link");
                            const title = titleEl ? (await titleEl.innerText()).trim() : "";
                            const url = titleEl ? await titleEl.getAttribute("href") : "";
                            if (!title || !url) {
                                stats.productsFailed++;
                                continue;
                            }
                            if (seenProductUrls.has(url)) continue;

                            // Price: .price element, e.g. "֏450" or "1,599 ֏". Keep digits + one dot
                            // (decimal sep) but strip thousands separators (commas, spaces).
                            const priceEl = await item.$(".price-box .price, .price");
                            const priceText = priceEl ? (await priceEl.innerText()).trim() : "";
                            let priceValue = null;
                            if (priceText) {
                                // Remove currency + whitespace + commas; preserve dot.
                                const cleaned = priceText.replace(/[^\d.,]/g, "").replace(/,/g, "");
                                const parsed = parseFloat(cleaned);
                                if (!isNaN(parsed) && parsed > 0) priceValue = parsed;
                            }
                            if (priceValue == null) {
                                stats.priceParseFailed++;
                                continue;
                            }

                            // Unit — carrefour no longer exposes .price-unit-description on listings.
                            // Derive from title.
                            const unit = extractUnitFromTitle(title);

                            const imgEl = await item.$("a.product-item-photo img");
                            const img = imgEl ? await imgEl.getAttribute("src") : "";

                            seenProductUrls.add(url);
                            allProducts.push({
                                category_name: cat.name,
                                category_url: cat.url,
                                category_slug: cat.slug,
                                title,
                                price: String(priceValue),
                                unit,
                                image_url: img || "",
                                product_url: url,
                                currency: "AMD",
                            });
                            stats.productsScraped++;
                        } catch (err) {
                            stats.productsFailed++;
                        }
                    }

                    const nextBtn = await page.$("a.action.next");
                    if (nextBtn) {
                        const nextUrl = await nextBtn.getAttribute("href");
                        if (nextUrl) {
                            await page.goto(nextUrl);
                            await page.waitForLoadState("domcontentloaded");
                            pageNum++;
                        } else {
                            hasNextPage = false;
                        }
                    } else {
                        hasNextPage = false;
                    }

                    if (pageNum > 50) hasNextPage = false; // safety
                }
            } catch (e) {
                console.error(`Error processing cat ${cat.name}: ${e.message}`);
            }
        }

        const outputPath = path.join(
            outputDir,
            targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_carrefour_am.json"
        );
        fs.writeFileSync(outputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        console.log(
            `Scraped total ${allProducts.length} items (failed: ${stats.productsFailed}, price-parse-failed: ${stats.priceParseFailed}). Saved to ${outputPath}`
        );
    } catch (err) {
        console.error(`Global error: ${err.message}`);
    } finally {
        await browser.close();
    }
}

if (require.main === module) scrape();

module.exports = scrape;

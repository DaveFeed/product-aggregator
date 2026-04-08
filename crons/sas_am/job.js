const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.sas.am";

async function handleAgeVerification(page) {
    try {
        const yesButton = await page.$(".js-yes-button");
        if (yesButton && (await yesButton.isVisible())) {
            console.log("  Found age verification popup. Clicking 'Yes'...");
            await yesButton.click();
            // Wait for it to disappear
            await page.waitForTimeout(500);
        }
    } catch (e) {
        console.log("  Error checking age verification: " + e.message);
    }
}

async function scrape() {
    // Load config
    const config = process.env.JOB_CONFIG
        ? JSON.parse(process.env.JOB_CONFIG)
        : {
              base_url: BASE_URL,
              output_dir: "./data",
          };

    const outputDir = path.resolve(config.output_dir || "./data");
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Starting scrape for ${config.base_url}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
        console.log(`Navigating to ${BASE_URL}/en to find categories...`);
        await page.goto(`${BASE_URL}/en`);
        await page.waitForLoadState("domcontentloaded");

        // Extract categories
        const categoryLinks = await page.$$("a.main-menu__link-level-3");
        const categories = [];
        const seenUrls = new Set();

        for (const link of categoryLinks) {
            let url = await link.getAttribute("href");
            const name = await link.textContent();

            if (url && !seenUrls.has(url)) {
                if (!url.startsWith("http")) {
                    url = BASE_URL + url;
                }
                categories.push({ name: name.trim(), url: url });
                seenUrls.add(url);
            }
        }

        console.log(`Found ${categories.length} categories.`);

        // Filter categories if argument provided
        const targetCategory = process.argv.find((arg) => arg.startsWith("--category="));
        let categoriesToScrape = categories;

        if (targetCategory) {
            const categoryName = targetCategory.split("=")[1];
            console.log(`Filtering for category: ${categoryName}`);
            categoriesToScrape = categories.filter((c) => c.name === categoryName);
            if (categoriesToScrape.length === 0) {
                console.error(`Category '${categoryName}' not found!`);
                return;
            }
        }

        const allProducts = [];

        for (let i = 0; i < categoriesToScrape.length; i++) {
            const category = categoriesToScrape[i];
            console.log(
                `[${i + 1}/${categoriesToScrape.length}] Scraping category: ${category.name} (${category.url})`
            );

            try {
                await page.goto(category.url);
                await handleAgeVerification(page);
            } catch (e) {
                console.error(`Failed to load category ${category.name}: ${e.message}`);
                continue;
            }

            let pageNum = 1;
            let categoryProductsCount = 0;

            while (true) {
                console.log(`  Scraping page ${pageNum}...`);

                try {
                    await page.waitForLoadState("domcontentloaded");
                    await page.waitForSelector("a.product__cover-link", {
                        state: "attached",
                        timeout: 10000,
                    });
                } catch (e) {
                    console.log("  No products found or timeout on this page.");
                    break;
                }

                const productLinks = await page.$$("a.product__cover-link");
                console.log(`  Found ${productLinks.length} products on page ${pageNum}.`);

                if (productLinks.length === 0) {
                    break;
                }

                for (const link of productLinks) {
                    try {
                        let productUrl = await link.getAttribute("href");
                        if (productUrl && !productUrl.startsWith("http")) {
                            productUrl = BASE_URL + productUrl;
                        }

                        // Find parent element
                        const parent = await link.evaluateHandle(
                            (el) => el.closest(".product") || el.closest(".product-item") || el.parentElement
                        );

                        // Image
                        const imageEl = await parent.$(".product__image");
                        let imageUrl = "";
                        if (imageEl) {
                            imageUrl = await imageEl.getAttribute("data-src");
                            if (!imageUrl) {
                                imageUrl = await imageEl.getAttribute("src");
                            }
                            if (imageUrl && !imageUrl.startsWith("http")) {
                                imageUrl = BASE_URL + imageUrl;
                            }
                        }

                        // Title
                        const titleEl = await parent.$(".product__name");
                        const title = titleEl ? await titleEl.innerText() : "Unknown";

                        // Price extraction with Dual Pricing support
                        let price = "N/A";
                        let unit = "";
                        let pricingMetadata = {};

                        // Try finding price element
                        const priceEl = await parent.$(".product__price, .price, .product-item__price");
                        if (priceEl) {
                            let rawPrice = await priceEl.innerText();
                            // Example formats:
                            // "36 420 / 1 kg"
                            // "2 950 ֏\n1 pcs"
                            // "1200 / 1 kg\n100 / 1 pc" (Hypothetical dual display)

                            const cleanPrice = (str) => parseFloat(str.replace(/[^\d.]/g, "") || "0");

                            // Normalize text to single line for easier regex processing if needed, or split by line
                            const lines = rawPrice
                                .split("\n")
                                .map((l) => l.trim())
                                .filter((l) => l);

                            lines.forEach((line) => {
                                const lower = line.toLowerCase();
                                const val = cleanPrice(line);

                                if (lower.includes("kg")) {
                                    pricingMetadata.per_kg = val;
                                } else if (lower.includes("pc") || lower.includes("hat") || lower.includes("pcs")) {
                                    pricingMetadata.per_pc = val;
                                } else if (lower.includes("g") && !lower.includes("kg")) {
                                    // Handle grams if necessary, normally mapped to weight
                                }

                                // Default logic: if we found a value and haven't set main price, use it
                                // Or heuristic: 'per pc' is usually the pay price if present, else 'per kg'
                                if (price === "N/A" && val > 0) {
                                    price = val.toString(); // Store as string to match schema
                                }
                            });

                            // Specific override: If both exist, we usually buy 'per pc' if it's a discrete item
                            if (pricingMetadata.per_pc) {
                                price = pricingMetadata.per_pc.toString();
                            } else if (pricingMetadata.per_kg) {
                                price = pricingMetadata.per_kg.toString();
                            }

                            // Fallback for simple "3000 AMD" without unit
                            if (Object.keys(pricingMetadata).length === 0) {
                                price = cleanPrice(rawPrice).toString();
                            }
                        }

                        // Try finding unit element (for display unit)
                        const unitEl = await parent.$(".product__unit, .product-item__unit");
                        if (unitEl) {
                            unit = (await unitEl.innerText()).trim();
                        }

                        // Fallback: Parse text if selectors failed or price is 0
                        if (!price || price === "0" || price === "N/A") {
                            // ... existing fallback ...
                        }

                        // ... (detail page fallback logic can remain similar or be updated if strictly needed) ...

                        allProducts.push({
                            category_name: category.name,
                            category_url: category.url,
                            title: title.trim(),
                            price: price,
                            unit: unit,
                            image_url: imageUrl,
                            product_url: productUrl,
                            add_to_cart_selector: addToCartSelector,
                            metadata: { pricing: pricingMetadata }, // Store dual pricing here
                        });
                        categoryProductsCount++;
                    } catch (e) {
                        console.error(`  Error scraping a product: ${e.message}`);
                    }
                }

                // Next page
                const nextButton = await page.$("a.pagination__arrow.pagination__arrow--right");
                if (nextButton) {
                    try {
                        // Check for age verification popup overlay before clicking next
                        await handleAgeVerification(page);

                        await nextButton.click();
                        await page.waitForLoadState("networkidle");
                        pageNum++;
                    } catch (e) {
                        // One more try for overlay interference
                        console.log("  Click failed, retrying after checking popup...");
                        await handleAgeVerification(page);
                        try {
                            await nextButton.click();
                            await page.waitForLoadState("networkidle");
                            pageNum++;
                        } catch (e2) {
                            console.log("  Could not click next page. Finishing category.");
                            break;
                        }
                    }
                } else {
                    break;
                }
            }
            console.log(`Finished category ${category.name}. Total products: ${categoryProductsCount}`);

            // Incremental save
            const outputPath = path.join(
                outputDir,
                targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_sas.json"
            );
            fs.writeFileSync(outputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        }

        const finalOutputPath = path.join(
            outputDir,
            targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_sas.json"
        );
        fs.writeFileSync(finalOutputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        console.log(`Scraped total ${allProducts.length} products. Saved to ${finalOutputPath}`);
    } catch (err) {
        console.error(`Global error: ${err.message}`);
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    scrape();
}

module.exports = scrape;

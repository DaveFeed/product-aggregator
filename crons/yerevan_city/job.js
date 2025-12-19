const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://yerevan-city.am";

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
        console.log(`Navigating to ${BASE_URL}/shop/categories to find categories...`);
        await page.goto(BASE_URL);
        await page.waitForLoadState("domcontentloaded");

        // Switch to English
        try {
            console.log("Attempting to switch to English...");
            // 1. Open Settings/Menu (Clicking element with flag or similar)
            // Trying generic approach or looking for flag icon
            // Based on subagent, it's a settings button. Selector likely .header-settings or similar.
            // We'll search for the English text directly if visible, or the menu.
            // Let's try locating "English" directly, or the burger menu.
            // Attempting to click the language switcher (often has current lang flag)
            const langToggle = await page.$(
                '.header__lang, .lang-switcher, [alt="ARM"], [alt="hy"], .header-mobile__lang',
            );
            if (langToggle) await langToggle.click();

            // Wait for 'English' text and click
            const enBtn = await page.waitForSelector("text=English", {
                timeout: 2000,
                state: "attached", // wait for attached, not visible
            });
            if (enBtn) {
                await enBtn.click({ force: true });
                await page.waitForLoadState("networkidle");
                console.log("Switched to English!");
            }
        } catch (e) {
            console.warn("Could not switch to English (might already be EN or selector failed):", e.message);
        }

        console.log(`Navigating to ${BASE_URL}/shop/categories to find categories...`);
        await page.goto(`${BASE_URL}/shop/categories`);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(3000);

        // Extract categories
        // Each category is a div with class P-product-item
        // We'll extract the category name and ID from the element's attributes
        // Extract categories
        // Correct selector based on debug: Links with href containing /shop/products/
        // Extract categories
        // Correct selector: div.P-product-item contains 'a' and 'p'
        const categories = await page.$$eval("div.P-product-item", (elements) => {
            return elements
                .map((el) => {
                    const a = el.querySelector("a");
                    const p = el.querySelector("p");
                    if (!a || !p) return null;

                    const href = a.href;
                    if (!href || !href.includes("/shop/products/")) return null;

                    const match = href.match(/\/shop\/products\/(\d+)$/);
                    if (!match) return null;

                    const categoryId = match[1];
                    const name = p.innerText.trim(); // Grab whole text from <p>

                    if (!name) return null;

                    return {
                        name,
                        categoryId,
                        element: true,
                    };
                })
                .filter((c) => c !== null);
        });

        // If we couldn't extract IDs, use a fallback list of common categories
        // Based on observation, category URLs are like /shop/products/22
        let finalCategories = [];

        if (categories.length === 0) {
            console.log("Could not auto-detect categories, using fallback approach...");
            // We'll scrape the visible category names and try sequential IDs
            const categoryNames = await page.$$eval(".P-product-item p", (elements) =>
                elements.map((el) => el.innerText.trim()),
            );

            // Try category IDs from 1 to 50 (most sites don't have more)
            for (let id = 1; id <= 50; id++) {
                const url = `${BASE_URL}/shop/products/${id}`;
                try {
                    const response = await page.goto(url, {
                        waitUntil: "domcontentloaded",
                        timeout: 5000,
                    });
                    if (response && response.ok()) {
                        // This category exists
                        const name = categoryNames[finalCategories.length] || `Category ${id}`;
                        finalCategories.push({ name, url });
                        console.log(`Found category: ${name} -> ${url}`);
                    }
                } catch (e) {
                    // Category doesn't exist, skip
                }

                // Limit to reasonable number
                if (finalCategories.length >= categoryNames.length || finalCategories.length >= 20) {
                    break;
                }
            }
        } else {
            finalCategories = categories.map((c) => ({
                name: c.name,
                url: `${BASE_URL}/shop/products/${c.categoryId}`,
            }));
        }

        console.log(`Found ${finalCategories.length} categories.`);

        // Filter categories if argument provided
        const targetCategory = process.argv.find((arg) => arg.startsWith("--category="));
        let categoriesToScrape = finalCategories;

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
                `[${i + 1}/${categoriesToScrape.length}] Scraping category: ${category.name} (${category.url})`,
            );

            try {
                await page.goto(category.url);
                await page.waitForLoadState("domcontentloaded");
                await page.waitForTimeout(2000);
            } catch (e) {
                console.error(`Failed to load category ${category.name}: ${e.message}`);
                continue;
            }

            // This site uses infinite scroll
            // We need to scroll down multiple times to load all products
            let previousProductCount = 0;
            let scrollAttempts = 0;
            const maxScrollAttempts = 20; // Limit scrolling

            console.log(`  Loading products via infinite scroll...`);

            while (scrollAttempts < maxScrollAttempts) {
                // Scroll to bottom
                await page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });

                await page.waitForTimeout(2000); // Wait for content to load

                // Count current products
                const currentProductCount = await page.$$eval("a.P-padding-products", (elements) => elements.length);

                console.log(`  Scroll ${scrollAttempts + 1}: Found ${currentProductCount} products`);

                if (currentProductCount === previousProductCount) {
                    // No new products loaded, we're done
                    console.log(`  No new products loaded, finishing category.`);
                    break;
                }

                previousProductCount = currentProductCount;
                scrollAttempts++;
            }

            // Now scrape all the products
            const productLinks = await page.$$("a.P-padding-products");
            console.log(`  Scraping ${productLinks.length} products...`);

            for (let j = 0; j < productLinks.length; j++) {
                try {
                    const link = productLinks[j];

                    // Get product URL
                    let productUrl = await link.getAttribute("href");
                    if (productUrl && !productUrl.startsWith("http")) {
                        productUrl = BASE_URL + productUrl;
                    }

                    // Get product details from the link element
                    const productData = await link.evaluate((el) => {
                        // Find subcategory/type (span)
                        const subcategoryEl = el.querySelector("span");
                        const subcategory = subcategoryEl ? subcategoryEl.innerText.trim() : "";

                        // Find title (p tag, not inside the price section)
                        const pTags = el.querySelectorAll("p");
                        let title = "";
                        for (const p of pTags) {
                            // Check if this p contains a span with price
                            if (!p.querySelector("span")) {
                                title = p.innerText.trim();
                                break;
                            }
                        }

                        // Find price (span inside p)
                        const priceEl = el.querySelector("p span");
                        const price = priceEl ? priceEl.innerText.trim() : "N/A";

                        // Extract Unit from Title or other elements
                        let unit = "";
                        // Regex for Armenian, English, and Russian units
                        // Armenian: կգ, գ, լ, մլ
                        // Russian: кг, г, л, мл, шт
                        const unitMatch = title.match(/(\d+(\.\d+)?)\s*(kg|g|pcs|l|ml|կգ|գ|լ|մլ|հատ|кг|г|шт)/i);
                        if (unitMatch) {
                            unit = unitMatch[0];
                        } else if (
                            title.toLowerCase().includes("կգ") ||
                            title.toLowerCase().includes("kg") ||
                            title.toLowerCase().includes("кг")
                        ) {
                            unit = "1 kg"; // Fallback
                        }

                        // Find image - it's in a nested div structure
                        // The image is dynamically loaded, so we look for background-image or img
                        const imgContainer = el.querySelector("div > div > div");
                        let imageUrl = "";

                        if (imgContainer) {
                            const bgImage = window.getComputedStyle(imgContainer).backgroundImage;
                            if (bgImage && bgImage !== "none") {
                                // Extract URL from url("...")
                                const match = bgImage.match(/url\(["']?([^"']*)["']?\)/);
                                if (match) {
                                    imageUrl = match[1];
                                }
                            }

                            // Fallback: check for img tag
                            if (!imageUrl) {
                                const imgEl = imgContainer.querySelector("img");
                                if (imgEl) {
                                    imageUrl = imgEl.src || imgEl.getAttribute("data-src") || "";
                                }
                            }
                        }

                        return {
                            subcategory,
                            title,
                            price,
                            unit, // Return unit
                            imageUrl,
                        };
                    });

                    // Make sure image URL is absolute
                    let imageUrl = productData.imageUrl;
                    if (imageUrl && !imageUrl.startsWith("http")) {
                        imageUrl = BASE_URL + imageUrl;
                    }

                    allProducts.push({
                        category_name: category.name,
                        category_url: category.url,
                        subcategory: productData.subcategory,
                        title: productData.title,
                        price: productData.price,
                        unit: productData.unit,
                        image_url: imageUrl,
                        product_url: productUrl,
                    });

                    if ((j + 1) % 50 === 0) {
                        console.log(`    Scraped ${j + 1}/${productLinks.length} products...`);
                    }
                } catch (e) {
                    console.error(`  Error scraping product: ${e.message}`);
                }
            }

            console.log(`Finished category ${category.name}. Total products: ${productLinks.length}`);

            // Incremental Save
            const outputPath = path.join(
                outputDir,
                targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_yerevan_city.json",
            );
            fs.writeFileSync(outputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        }

        const finalOutputPath = path.join(
            outputDir,
            targetCategory ? `products_${targetCategory.split("=")[1]}.json` : "products_yerevan_city.json",
        );
        fs.writeFileSync(finalOutputPath, JSON.stringify(allProducts, null, 2), "utf-8");
        console.log(`Scraped total ${allProducts.length} products. Saved to ${finalOutputPath}`);
    } catch (err) {
        console.error(`Global error: ${err.message}`);
        console.error(err.stack);
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    scrape();
}

module.exports = scrape;

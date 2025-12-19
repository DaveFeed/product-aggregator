const { Scenes, Markup } = require("telegraf");
const Product = require("../../models/Product");
const Provider = require("../../models/Provider");
const { formatPrice } = require("../utils");

let extractor = null;

const searchScene = new Scenes.WizardScene(
    "search",
    async (ctx) => {
        await ctx.reply("Please enter the product name you are looking for:", Markup.keyboard([["🔙 Back"]]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        const text = ctx.message.text;

        if (!text) {
            return ctx.reply("Please send text.");
        }

        await ctx.reply(`🔍 Searching for "${text}"...`);

        try {
            // Lazy load model
            if (!extractor) {
                // Initialize extractor with Multilingual model
                const { pipeline } = await import("@xenova/transformers");
                extractor = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-MiniLM-L12-v2");
            }

            // Generate embedding
            const output = await extractor(text, { pooling: "mean", normalize: true });
            const queryVector = JSON.stringify(Array.from(output.data));

            // Vector search: Cosine distance (<=>)
            // Limit to top 20 relevant results across all providers
            // Threshold: 0.6 (0 is identical, 1 is orthogonal)
            const products = await Product.query()
                .select("*", Product.knex().raw("embedding <=> ? as distance", [queryVector]))
                .whereNotNull("embedding")
                .where(Product.knex().raw("embedding <=> ? < 0.6", [queryVector]))
                .orderByRaw("embedding <=> ? ASC", [queryVector])
                .limit(15)
                .withGraphFetched("provider");

            if (products.length === 0) {
                await ctx.reply("No matches found.");
            } else {
                let message = `Results for "${text}":\n\n`;

                // Grouping by provider might be nice, but for semantic search, relevance is key.
                // Let's show listing with Provider tag.
                // Also distinct by title? Sometimes same product in duplicates.
                // Let's just list top 10 distinct-ish items or just all 20? 20 is a lot for one message.
                // Let's show top 15.

                const topProducts = products.slice(0, 15);

                topProducts.forEach((p) => {
                    const price = formatPrice(p.price);
                    const providerName = p.provider ? p.provider.display_name : "Unknown";
                    // E.g. [SAS] Apple - 500 AMD
                    message += `*${providerName}*\n[${p.title}](${p.fetch_url}) - *${price}*\n\n`;
                });

                await ctx.replyWithMarkdown(message, {
                    disable_web_page_preview: true,
                });
            }
        } catch (err) {
            console.error("Search error:", err);
            await ctx.reply("An error occurred during search.");
        }
    }
);

searchScene.hears("🔙 Back", (ctx) => ctx.scene.enter("home"));

module.exports = searchScene;

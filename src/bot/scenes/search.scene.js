const { Scenes, Markup } = require("telegraf");
const { formatPrice, escapeMarkdown } = require("../utils");

const searchScene = new Scenes.WizardScene(
    "search",
    async (ctx) => {
        await ctx.reply(
            "Please enter the product name you are looking for in english:",
            Markup.keyboard([["🔙 Back"]]).resize()
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        const text = ctx.message.text;

        if (!text) {
            return ctx.reply("Your input should be a text in english:");
        }

        await ctx.reply(`🔍 Searching for "${text}"...`);

        try {
            // lazy load to avoid circular dependency
            const SearchService = require("../../services/SearchService");
            const results = await SearchService.search(text);

            if (results.length === 0) {
                await ctx.reply("No matches found.");
            } else {
                let message = `Results for "${escapeMarkdown(text)}":\n\n`;

                results.forEach((p) => {
                    const price = escapeMarkdown(formatPrice(p.price));
                    const providerName = escapeMarkdown(p.provider_name || "Unknown");
                    const reason = p.match_reason ? `\n_💡 ${escapeMarkdown(p.match_reason)}_` : "";

                    const safeTitle = escapeMarkdown(p.title);

                    message += `*${providerName}*\n[${safeTitle}](${p.product_url}) \\- *${price}*${reason}\n\n`;
                });

                await ctx.reply(message, {
                    disable_web_page_preview: true,
                    parse_mode: "MarkdownV2",
                });
            }
        } catch (err) {
            console.error("Search error:", err);
            await ctx.reply("An error occurred during search. Please try again later.");
        }
    }
);

searchScene.hears("🔙 Back", (ctx) => ctx.scene.enter("home"));

module.exports = searchScene;

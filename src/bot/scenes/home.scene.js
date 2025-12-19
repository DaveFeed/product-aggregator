const { Scenes, Markup } = require("telegraf");

const homeScene = new Scenes.BaseScene("home");

homeScene.enter(async (ctx) => {
    await ctx.reply(
        "Welcome to the Product Aggregator Bot! 🛒\n\nI can help you search for products across multiple providers (SAS, Yerevan City, etc.) and browse the catalog.",
        Markup.keyboard([["🔍 Search", "📋 Catalog"], ["⚙️ Settings"]]).resize(),
    );
});

homeScene.hears("🔍 Search", (ctx) => ctx.scene.enter("search"));
homeScene.hears("📋 Catalog", (ctx) => ctx.scene.enter("catalog"));
homeScene.hears("⚙️ Settings", (ctx) => ctx.scene.enter("settings"));

module.exports = homeScene;

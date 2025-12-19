const { Scenes, Markup } = require("telegraf");

const settingsScene = new Scenes.BaseScene("settings");

settingsScene.enter(async (ctx) => {
    const name = ctx.from.first_name || "User";
    await ctx.reply(`Sorry ${name}, this is not implemented yet.`, Markup.keyboard([["🔙 Back"]]).resize());
});

settingsScene.hears("🔙 Back", (ctx) => ctx.scene.enter("home"));

module.exports = settingsScene;

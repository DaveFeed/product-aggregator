require("dotenv").config();
const { ChatOpenAI } = require("@langchain/openai");
const readline = require("readline");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
// const { XenovaEmbeddings } = require("./langchain_xenova_example"); // Handled by SearchService
const SearchService = require("../services/SearchService");
const { Model } = require("objection");
const Knex = require("knex");
const knexConfig = require("../../knexfile");

// Initialize Database
const knex = Knex(knexConfig.development);
Model.knex(knex);

// Helper to parse price string "1,200 ֏" -> number
const parsePrice = (p) => {
    if (typeof p === "number") return p;
    return parseFloat(p.replace(/[^0-9.]/g, ""));
};

async function runAgent() {
    console.log("-----------------------------------------");
    console.log("🍳 Agentic Retrieval Cooking Assistant");
    console.log("-----------------------------------------");

    if (!process.env.OPENAI_API_KEY) {
        console.error("Error: OPENAI_API_KEY is not set in .env");
        process.exit(1);
    }

    const chat = new ChatOpenAI({ modelName: "gpt-5-mini" }); // Using smart model for logic
    // Embeddings init is now handled inside SearchService lazy loading or init

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

    console.log("\nWhat would you like to cook today?");
    console.log("(Press Enter to get suggestions based on the chef's choice)");
    let userInput = await ask("> ");

    let currentPrompt = userInput.trim() || "Please suggest something";
    let dishName = currentPrompt; // Will be updated if suggestion chosen

    const systemMsg = new SystemMessage(`
        You are a chef. List the INGREDIENT INTENTS needed to cook the users prompted dish.
        Return a JSON object.
        
        If the user asks for suggestions or gives empty input, return:
        { "suggestions": ["Dish A", "Dish B"] }

        If the user prompts a dish, return:
        {
            "intents": [
                {
                    "name": "canonical ingredient name (generic, lowercased, no brands)",
                    "quantity": number,
                    "unit": "g" | "kg" | "ml" | "l" | "pc",
                    "constraints": ["list", "of", "constraints"]
                }
            ]
        }
        Do NOT include generic pantry items like salt, pepper, oil, water.
    `);

    console.log("\n🤔 Consulting the chef...");
    let response = await chat.invoke([systemMsg, new HumanMessage(currentPrompt)]);

    let parseJson = (text) => {
        try {
            return JSON.parse(
                text
                    .replace(/```json/g, "")
                    .replace(/```/g, "")
                    .trim()
            );
        } catch (e) {
            return null;
        }
    };

    let json = parseJson(response.content);
    if (!json) {
        console.error("Failed to parse output:", response.content);
        process.exit(1);
    }

    // Handle suggestions
    if (json.suggestions) {
        console.log("\nHere are some suggestions:");
        json.suggestions.forEach((s, i) => console.log(`${i + 1}. ${s}`));

        const choice = await ask("\nEnter the number of your choice (or type a dish name): ");
        const index = parseInt(choice) - 1;

        if (!isNaN(index) && json.suggestions[index]) {
            dishName = json.suggestions[index];
        } else {
            dishName = choice;
        }

        console.log(`\nGreat choice: ${dishName}. Planning ingredients...`);
        response = await chat.invoke([systemMsg, new HumanMessage(dishName)]);
        json = parseJson(response.content);
        if (!json) {
            console.error("Failed to plan ingredients:", response.content);
            process.exit(1);
        }
    }

    let intents = json.intents || (json.ingredients ? json.ingredients : []);
    console.log(`=> Identified ${intents.length} ingredient intents.`);

    console.log("\n🛒 Retrieving and Validating products...");
    const shoppingList = [];
    let totalCost = 0;

    for (const intent of intents) {
        // Use SearchService
        const candidates = await SearchService.searchWithIntent(intent);

        // Agent Selection (SearchService already filtered and ranked, so we pick top)
        let selectedProduct = null;
        if (candidates.length > 0) {
            selectedProduct = candidates[0];
        }

        if (selectedProduct) {
            console.log(`   ✅ Selected: ${selectedProduct.title} (${selectedProduct.price})`);
            if (selectedProduct.match_reason) console.log(`      Reason: ${selectedProduct.match_reason}`);

            shoppingList.push({
                ...intent,
                product_title: selectedProduct.title,
                price: selectedProduct.price,
                url: selectedProduct.product_url,
            });
            totalCost += parsePrice(selectedProduct.price);
        } else {
            console.log(`   ❌ No suitable match found for '${intent.name}'`);
            shoppingList.push({ ...intent, found: false });
        }
    }

    console.log("\n📋 Final Shopping List:");
    console.log(
        JSON.stringify(
            shoppingList.map((i) => ({
                intent: i.name,
                qty: `${i.quantity}${i.unit}`,
                found: !!i.price,
                product: i.product_title || "N/A",
                price: i.price || 0,
                url: i.url || "N/A",
            })),
            null,
            2
        )
    );

    await knex.destroy();
    rl.close();
}

if (require.main === module) {
    runAgent().catch(console.error);
}

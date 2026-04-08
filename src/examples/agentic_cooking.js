require("dotenv").config();
const { ChatOpenAI } = require("@langchain/openai");
const readline = require("readline");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { XenovaEmbeddings } = require("./langchain_xenova_example");
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

async function findCheapestProduct(ingredient, embeddings) {
    // Clean ingredient: "pizza dough (for 2 pizzas)" -> "pizza dough"
    const cleanedIngredient = ingredient.replace(/\s*\(.*?\)\s*/g, " ").trim();

    // 1. Get embedding for the ingredient
    const vector = await embeddings.embedQuery(cleanedIngredient);

    // 2. Search DB: Find top 10 relevant products by semantic similarity
    // We get more than 1 to filter/sort by price
    const { rows } = await knex.raw(
        `SELECT id, title, price, fetch_url as product_url, provider_id, 
         (embedding <=> ?::vector) as distance 
         FROM products 
         WHERE price IS NOT NULL 
         ORDER BY distance ASC 
         LIMIT 10`,
        [JSON.stringify(vector)]
    );

    if (rows.length === 0) return null;

    // 3. Sort specific semantic matches by price to get the "cheapest relevant" one
    // Note: Pure lowest price might return accessories, so we trust the semantic search
    // to give us relevant items first, then we pick the cheapest among them.
    // A better way is: filter by distance threshold (e.g. < 0.4), then sort by price.

    const relevant = rows.filter((r) => r.distance < 0.5); // Semantic threshold
    const candidates = relevant.length > 0 ? relevant : rows.slice(0, 3); // Fallback to top 3 if no close match

    candidates.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));

    return candidates[0];
}

async function runAgent() {
    console.log("-----------------------------------------");
    console.log("🍳 Starting Agentic Cooking Assistant");
    console.log("-----------------------------------------");

    if (!process.env.OPENAI_API_KEY) {
        console.error("Error: OPENAI_API_KEY is not set in .env");
        process.exit(1);
    }

    const chat = new ChatOpenAI({
        modelName: "gpt-5-mini",
        // temperature: 1,
    });

    const embeddings = new XenovaEmbeddings({
        modelName: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    });
    await embeddings.init();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

    console.log("\nWhat would you like to cook today?");
    console.log("(Press Enter to get suggestions based on the chef's choice)");
    let userInput = await ask("> ");

    let currentPrompt = userInput.trim() || "Please suggest something";
    let dishName = currentPrompt; // Will be updated if suggestion chosen

    const systemMsg = new SystemMessage(`
        You are a chef. List the main ingredients needed to cook the users prompted dish.
        If the user hasn't prompted a dish (or asks for suggestions), return a JSON object with a key 'suggestions' which is an array of strings.
        Example: {"suggestions": ["Pizza Margherita for 2 people", "Pasta Carbonara for 2 people"]}
        Suggestions are human readable dish names for the user to choose and prompt if needed.
        If the user has prompted a dish, return a JSON object with a key 'ingredients' which is an array of objects.
        Example: {"ingredients": [{"name": "chicken breast", "quantity": "200", "unit": "g"}, {"name": "rice", "quantity": "200", "unit": "g"}, {"name": "onions", "quantity": "2", "unit": "pc"}]}
        Do NOT include generic pantry items like salt, pepper, oil, water.
        The ingredient names should be generically typed for searching, not specific to a brand or store.
        The ingredient units should be in metric, possible units are "g", "kg", "ml", "l", "pc".
        The ingredient quantity should be a number. Can be quoted or not.
        Your response should be a valid JSON object and nothing more.`);

    console.log("\n🤔 Consulting the chef...");
    let response = await chat.invoke([systemMsg, new HumanMessage(currentPrompt)]);

    let ingredients = [];

    // Parse helper
    const parseJson = (text) => {
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
        console.error("Failed to parse JSON response:", response.content);
        process.exit(1);
    }

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

        console.log(`\nGreat choice: ${dishName}. Getting ingredients...`);
        response = await chat.invoke([systemMsg, new HumanMessage(dishName)]);

        json = parseJson(response.content);
        if (!json || !json.ingredients) {
            console.error("Failed to get ingredients for choice:", response.content);
            process.exit(1);
        }
    }

    if (json.ingredients) {
        ingredients = json.ingredients;
    } else {
        console.error("Unexpected response format:", json);
        process.exit(1);
    }

    rl.close();

    console.log(`=> Ingredients needed: ${ingredients.map((i) => `${i.name} (${i.quantity}${i.unit})`).join(", ")}`);

    console.log("\n🛒 Searching database for cheapest products...");
    const shoppingList = [];
    let totalCostArgs = 0;

    const MAX_INGREDIENTS = 20;
    const ingredientsToSearch = ingredients.slice(0, MAX_INGREDIENTS);

    for (const item of ingredientsToSearch) {
        const ingredientName = item.name;
        process.stdout.write(`   Searching for '${ingredientName}'... `);
        try {
            const product = await findCheapestProduct(ingredientName, embeddings);
            if (product) {
                console.log(`Found: ${product.title} (${product.price})`);
                shoppingList.push({
                    ingredient: ingredientName,
                    quantity: item.quantity,
                    unit: item.unit,
                    product_title: product.title,
                    price: product.price,
                    url: product.product_url || "No URL",
                });
                totalCostArgs += parsePrice(product.price);
            } else {
                console.log("❌ No product found.");
                shoppingList.push({
                    ingredient: ingredientName,
                    found: false,
                });
            }
        } catch (e) {
            console.log("Error searching:", e.message);
        }
    }

    console.log("\n📋 Generating Shopping List...");
    const finalPrompt = `
    I decided to cook: ${dishName}.
    
    Here is the result of my product search for ingredients:
    ${JSON.stringify(shoppingList, null, 2)}
    
    Please present this to the user as a nice shopping list. 
    - Group items if logical.
    - Show the exact product to buy and its price.
    - If an item wasn't found, suggest where to look or a substitute.
    - Calculate and display the subtotal for the found items.
    - Add a specialized tip for cooking this specific dish.
    `;

    console.log("\nFinal prompt:\n" + finalPrompt);

    const finalResponse = await chat.invoke([
        new SystemMessage("You are a helpful shopping assistant."),
        new HumanMessage(finalPrompt),
    ]);
    console.log("\n" + finalResponse.content);

    // Cleanup
    await knex.destroy();
}

if (require.main === module) {
    runAgent().catch(console.error);
}

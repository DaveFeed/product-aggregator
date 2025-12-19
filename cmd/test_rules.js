const rules = require("../processors/category_rules");

const samples = [
    "fish and seafood",
    "poultry",
    "fresh fish",
    "caviar",
    "Meat & Poultry", // Should map to itself if it falls through? No, keywords check.
    "Butter",
    "milk",
    "900 ֏",
];

console.log("Testing Rules:");
samples.forEach((s) => {
    console.log(`'${s}' -> ${rules.getUnifiedCategory(s)}`);
});

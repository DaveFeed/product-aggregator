const rules = require("../processors/category_rules");

const trash = "1,780 ֏\n1,550 ֏";
const trash2 = "1,780 ֏";
const valid = "Dairy & Eggs";

console.log(`Checking '${trash.replace(/\n/g, "\\n")}': ${rules.isValidCategory(trash)}`);
console.log(`Checking '${trash2}': ${rules.isValidCategory(trash2)}`);
console.log(`Checking '${valid}': ${rules.isValidCategory(valid)}`);

// Debug RegEx
const pattern = "^[\\d,\\.\\s]+֏.*";
const regex = new RegExp(pattern);
console.log(`Regex: ${pattern}`);
console.log(`Test multiline: ${regex.test(trash)}`);

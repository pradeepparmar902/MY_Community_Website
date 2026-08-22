import fs from "fs";
const code = fs.readFileSync("src/CharitableTrust.jsx", "utf8");
const lines = code.split("\n");
lines.forEach((l, idx) => {
  if (l.includes("ANAV =") || l.includes("const ANAV") || l.includes("let ANAV")) {
    console.log((idx + 1) + ": " + l.trim());
  }
});

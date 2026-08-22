import fs from "fs";
const code = fs.readFileSync("src/CharitableTrust.jsx", "utf8");
const lines = code.split("\n");
lines.forEach((l, idx) => {
  if (l.includes("function AdminInviteLetters") || l.includes("AdminInviteLetters")) {
    console.log((idx + 1) + ": " + l.trim());
  }
});

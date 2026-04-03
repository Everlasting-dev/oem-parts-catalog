"use strict";
/**
 * batch-import-amayama.js
 *
 * Imports EVERY .html file in a given folder via parse-amayama-html.js.
 * Usage:  node scripts/batch-import-amayama.js <folder-path>
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const folder = process.argv[2];
if (!folder || !fs.existsSync(folder)) {
  console.error("Usage: node scripts/batch-import-amayama.js <folder-with-html-files>");
  process.exit(1);
}

const PARSER = path.join(__dirname, "parse-amayama-html.js");
const files = fs.readdirSync(folder)
  .filter(f => f.endsWith(".html"))
  .sort();

console.log(`Found ${files.length} HTML files in: ${folder}\n`);

let ok = 0;
let fail = 0;

for (let i = 0; i < files.length; i++) {
  const fullPath = path.join(folder, files[i]);
  const shortName = files[i].substring(0, 60);
  process.stdout.write(`[${i + 1}/${files.length}] ${shortName} ... `);

  try {
    const out = execSync(`node "${PARSER}" "${fullPath}"`, {
      encoding: "utf8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const variantsMatch = out.match(/Variants added\s*:\s*(\d+)/);
    const newMatch = out.match(/New parts\s*:\s*(\d+)/);
    const fixedMatch = out.match(/Existing fixed\s*:\s*(\d+)/);
    console.log(
      `+${variantsMatch ? variantsMatch[1] : "?"} diagrams, ` +
      `+${newMatch ? newMatch[1] : "?"} new, ` +
      `~${fixedMatch ? fixedMatch[1] : "?"} updated`
    );
    ok++;
  } catch (err) {
    console.log(`FAILED: ${err.message.split("\n")[0]}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} succeeded, ${fail} failed out of ${files.length} files.`);

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "catalog-data.json"), "utf8").replace(/^\uFEFF/, ""));
console.log(`Final totals: ${data.parts.length} parts, ${data.diagrams.length} diagrams`);

"use strict";
/**
 * download-api-images.js
 *
 * Downloads every unique apiImageUrl in catalog-data.json, saves them to
 * assets/diagrams/api/, then updates each diagram's imagePath so the local
 * file is used everywhere (gallery, main catalog, index page).
 *
 * Usage:  node scripts/download-api-images.js
 */

const path   = require("path");
const fs     = require("fs");
const https  = require("https");
const http   = require("http");
const crypto = require("crypto");

const ROOT      = path.join(__dirname, "..");
const JSON_PATH = path.join(ROOT, "data", "catalog-data.json");
const JS_PATH   = path.join(ROOT, "data", "catalog-data.js");
const SAVE_DIR  = path.join(ROOT, "assets", "diagrams", "api");

if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });

function urlToFilename(url) {
  // Use the URL path basename; if there's no extension add .png
  try {
    const parsed = new URL(url);
    const base   = path.basename(parsed.pathname);
    // Prefix with a short domain hash to avoid collisions from different CDNs
    const prefix = crypto.createHash("md5").update(parsed.hostname).digest("hex").slice(0, 6);
    return base.includes(".") ? `${prefix}_${base}` : `${prefix}_${base}.png`;
  } catch {
    return crypto.createHash("md5").update(url).digest("hex") + ".png";
  }
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    const req  = mod.get(url, { timeout: 20000 }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlink(destPath, () => {});
        return download(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    });
    req.on("error", err => { file.close(); fs.unlink(destPath, () => {}); reject(err); });
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

async function main() {
  console.log("Loading catalog-data.json ...");
  const raw     = fs.readFileSync(JSON_PATH, "utf8").replace(/^\uFEFF/, "");
  const catalog = JSON.parse(raw);

  // Build map: url → local relative path
  const urlMap = new Map(); // url → "assets/diagrams/api/filename"
  for (const d of catalog.diagrams || []) {
    if (d.apiImageUrl && !urlMap.has(d.apiImageUrl)) {
      const filename = urlToFilename(d.apiImageUrl);
      urlMap.set(d.apiImageUrl, `assets/diagrams/api/${filename}`);
    }
  }
  console.log(`  ${urlMap.size} unique remote image URLs to download`);

  // Download (skip if already present)
  let downloaded = 0, skipped = 0, failed = 0;
  const urlList = [...urlMap.entries()];

  for (let i = 0; i < urlList.length; i++) {
    const [url, relPath] = urlList[i];
    const fullPath = path.join(ROOT, relPath);
    process.stdout.write(`\r  [${i+1}/${urlList.length}] ${path.basename(fullPath)}`.padEnd(80));

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0) {
      skipped++;
      continue;
    }

    try {
      await download(url, fullPath);
      downloaded++;
    } catch (e) {
      failed++;
      // Keep a note but don't abort
      process.stdout.write(` FAILED: ${e.message}`);
    }

    // Small polite delay
    await new Promise(r => setTimeout(r, 80));
  }

  console.log(`\n\n  Downloaded : ${downloaded}`);
  console.log(`  Skipped    : ${skipped}`);
  console.log(`  Failed     : ${failed}`);

  // Update catalog-data.json: fill imagePath for diagrams that had none
  let updated = 0;
  for (const d of catalog.diagrams || []) {
    if (!d.apiImageUrl) continue;
    const relPath = urlMap.get(d.apiImageUrl);
    if (!relPath) continue;
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) continue;

    // Only set imagePath if missing or pointing to a non-existent file
    const existingOk = d.imagePath && fs.existsSync(path.join(ROOT, d.imagePath));
    if (!existingOk) {
      d.imagePath = relPath;
      updated++;
    }
  }
  console.log(`\n  Updated imagePath for ${updated} diagrams`);

  // Save JSON
  fs.writeFileSync(JSON_PATH, JSON.stringify(catalog, null, 2), "utf8");
  console.log("  Saved catalog-data.json");

  // Rebuild JS bundle
  fs.writeFileSync(JS_PATH, "window.CATALOG_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
  console.log("  Rebuilt catalog-data.js  (" + (fs.statSync(JS_PATH).size / 1024 / 1024).toFixed(2) + " MB)");

  console.log("\nDone! Re-run add-gallery-sheet.js to refresh the Excel gallery.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

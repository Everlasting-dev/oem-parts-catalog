/**
 * scrape-diagram-parts.js
 *
 * For each diagram in catalog-data.json, loads its yoshiparts.com sourceUrl
 * in a headless Chromium browser, intercepts the internal JSON API call to
 * api.yoshiparts.com/part-list/..., and extracts:
 *
 *   - Hotspot bounding boxes (pixel coords on the diagram image)
 *   - Part reference numbers (refNumber) linked to product IDs
 *   - Product details: full Nissan part number, description
 *
 * Writes data/diagram-parts.json with all of this per diagram.
 *
 * Run from the project root:
 *   node scripts/scrape-diagram-parts.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CATALOG_FILE = path.join(PROJECT_ROOT, 'data', 'catalog-data.json');
const OUTPUT_FILE  = path.join(PROJECT_ROOT, 'data', 'diagram-parts.json');

const RATE_DELAY   = parseInt(process.env.RATE_DELAY_MS || '1500', 10);
const START_INDEX  = parseInt(process.env.START_INDEX   || '0',    10);

function loadCatalog() {
  let raw = fs.readFileSync(CATALOG_FILE, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

function loadExisting() {
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      let raw = fs.readFileSync(OUTPUT_FILE, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      return JSON.parse(raw);
    } catch { /* ignore */ }
  }
  return {};
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const catalog  = loadCatalog();
  const diagrams = catalog.diagrams || [];
  const output   = loadExisting();

  console.log(`Scraping ${diagrams.length} diagrams via yoshiparts API interception`);
  console.log(`Rate delay: ${RATE_DELAY} ms | Start index: ${START_INDEX}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  let successCount = 0;
  let failCount    = 0;

  for (let i = START_INDEX; i < diagrams.length; i++) {
    const diagram = diagrams[i];

    // Resume support: skip already-scraped diagrams that have data
    if (output[diagram.id] && output[diagram.id].hotspots &&
        Object.keys(output[diagram.id].hotspots).length > 0) {
      console.log(`[${i + 1}/${diagrams.length}] ${diagram.id} -- cached, skipping`);
      continue;
    }

    process.stdout.write(`[${i + 1}/${diagrams.length}] ${diagram.id} -- `);

    if (!diagram.sourceUrl) {
      process.stdout.write('no sourceUrl\n');
      output[diagram.id] = { hotspots: {}, items: [], products: {} };
      failCount++;
      continue;
    }

    // Intercept the API response
    let apiData = null;
    const handler = async (response) => {
      if (response.url().includes('api.yoshiparts.com/part-list/') ||
          response.url().includes('api.partsbooster.com/part-list/')) {
        try { apiData = JSON.parse(await response.text()); } catch {}
      }
    };
    page.on('response', handler);

    try {
      await page.goto(diagram.sourceUrl, { waitUntil: 'networkidle', timeout: 25000 });
      // Give extra time for the SPA to fire the API call
      if (!apiData) await sleep(3000);
    } catch (err) {
      process.stdout.write(`navigation error (${err.message.slice(0, 50)})\n`);
    }

    page.off('response', handler);

    if (apiData && apiData.diagram) {
      const hs       = apiData.diagram.hotspots || {};
      const items    = (apiData.diagramItems || []).map(it => ({
        refNumber:  it.refNumber,
        itemId:     it.itemId,
        qty:        it.qt,
      }));
      const rawProds = apiData.products || {};

      // Normalise products into a simpler map: id -> { number, name }
      const products = {};
      for (const [key, prod] of Object.entries(rawProds)) {
        products[prod.id || key] = {
          number:    prod.numberFormatted || prod.number || '',
          name:      prod.name || '',
          produced:  prod.isProduced,
        };
      }

      // Get the original diagram image dimensions from the API PNG
      const imgUrl = apiData.diagram.image?.originals;

      output[diagram.id] = {
        hotspots:  hs,
        items,
        products,
        imageUrl:  imgUrl || null,
      };

      const hCount = Object.keys(hs).length;
      const pCount = Object.keys(products).length;
      process.stdout.write(`${hCount} hotspots, ${pCount} products\n`);
      successCount++;
    } else {
      output[diagram.id] = { hotspots: {}, items: [], products: {} };
      process.stdout.write('no API data\n');
      failCount++;
    }

    // Save progress after each diagram
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

    if (i < diagrams.length - 1) await sleep(RATE_DELAY);
  }

  await browser.close();

  console.log(`\nDone.  Success: ${successCount} | Failed/empty: ${failCount}`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

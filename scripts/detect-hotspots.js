/**
 * detect-hotspots.js
 *
 * Reads all 144 diagram GIF images from assets/diagrams/,
 * pre-processes each one with Sharp, runs Tesseract.js OCR in
 * sparse-text mode and extracts word-level bounding boxes.
 * Filters results to Nissan part-code patterns.
 * Writes data/detected-labels.json.
 *
 * Run from the project root:
 *   node scripts/detect-hotspots.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const PROJECT_ROOT  = path.resolve(__dirname, '..');
const CATALOG_FILE  = path.join(PROJECT_ROOT, 'data', 'catalog-data.json');
const OUTPUT_FILE   = path.join(PROJECT_ROOT, 'data', 'detected-labels.json');

// ---------------------------------------------------------------------------
// Nissan part-code patterns
//   5-digit base + optional letter/plus suffixes:  62535EC  20300N  13270+A
//   Hardware part numbers with hyphens:  08918-3081A  08146-6205H
// ---------------------------------------------------------------------------
const PART_CODE = /^(?:\d{5}(?:[A-Z]{0,3})?(?:[+][A-Z])?(?:-\d{4,5}[A-Z]?)?)$/;

const TOKEN_SPLIT = /[\s,;|]+/;
const MIN_CONF    = 35;

// ---------------------------------------------------------------------------
// Load catalog (strip UTF-8 BOM if present)
// ---------------------------------------------------------------------------
function loadCatalog() {
  let raw = fs.readFileSync(CATALOG_FILE, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Pre-process: upscale to fixed width, greyscale, normalise
// ---------------------------------------------------------------------------
async function preprocess(imagePath) {
  const meta   = await sharp(imagePath).metadata();
  const origW  = meta.width  || 1024;
  const origH  = meta.height ||  768;
  const target = 1600;
  const scaleX = target / origW;
  const scaleY = scaleX;

  const buffer = await sharp(imagePath)
    .resize(target, null, { kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .normalise()
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer();

  return { buffer, origW, origH, scaleX, scaleY };
}

// ---------------------------------------------------------------------------
// Extract valid part codes from Tesseract blocks output
// In Tesseract.js v6+, blocks output must be explicitly requested:
//   worker.recognize(image, {}, { blocks: true })
// ---------------------------------------------------------------------------
function extractFromBlocks(blocks, origW, origH, scaleX, scaleY) {
  const found = new Map();

  function processWord(word) {
    if (!word || word.confidence < MIN_CONF) return;
    const candidates = (word.text || '').trim().toUpperCase().split(TOKEN_SPLIT);
    for (const tok of candidates) {
      const clean = tok.replace(/[^A-Z0-9\-+]/g, '');
      if (clean.length < 5) continue;
      if (!PART_CODE.test(clean)) continue;

      const bbox = word.bbox;
      const cx   = (bbox.x0 + bbox.x1) / 2;
      const cy   = (bbox.y0 + bbox.y1) / 2;
      const xPct = Math.round(cx / scaleX / origW * 10000) / 100;
      const yPct = Math.round(cy / scaleY / origH * 10000) / 100;

      if (!found.has(clean) || word.confidence > found.get(clean).conf) {
        found.set(clean, { x: xPct, y: yPct, conf: word.confidence });
      }
    }
  }

  if (!blocks) return [];
  for (const block of blocks) {
    if (!block.paragraphs) continue;
    for (const para of block.paragraphs) {
      if (!para.lines) continue;
      for (const line of para.lines) {
        if (!line.words) continue;
        for (const word of line.words) {
          processWord(word);
        }
      }
    }
  }

  return Array.from(found.entries()).map(([label, pos]) => ({
    label,
    x: pos.x,
    y: pos.y,
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const catalog  = loadCatalog();
  const diagrams = catalog.diagrams || [];

  if (diagrams.length === 0) {
    console.error('No diagrams found in catalog-data.json');
    process.exit(1);
  }

  console.log(`Processing ${diagrams.length} diagrams with Tesseract.js OCR...`);
  console.log('(This may take several minutes for all 144 diagrams.)\n');

  const worker = await createWorker('eng', 1, {
    logger: () => {},
  });

  await worker.setParameters({
    tessedit_pageseg_mode: '11',
    user_defined_dpi: '200',
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-+',
  });

  const output     = {};
  let totalLabels  = 0;

  for (let i = 0; i < diagrams.length; i++) {
    const diagram   = diagrams[i];
    const imagePath = diagram.imagePath
      ? path.join(PROJECT_ROOT, diagram.imagePath)
      : null;

    process.stdout.write(`[${String(i + 1).padStart(3)}/${diagrams.length}] ${diagram.id} ... `);

    if (!imagePath || !fs.existsSync(imagePath)) {
      process.stdout.write('image not found\n');
      output[diagram.id] = [];
      continue;
    }

    try {
      const { buffer, origW, origH, scaleX, scaleY } = await preprocess(imagePath);

      // Third argument { blocks: true } enables the word-level bounding box output
      const result = await worker.recognize(buffer, {}, { blocks: true });
      const blocks = result.data.blocks;

      const labels = extractFromBlocks(blocks, origW, origH, scaleX, scaleY);
      output[diagram.id] = labels;
      totalLabels += labels.length;
      process.stdout.write(`${labels.length} labels\n`);
    } catch (err) {
      process.stdout.write(`ERROR: ${err.message}\n`);
      output[diagram.id] = [];
    }

    // Save progress incrementally
    if ((i + 1) % 10 === 0 || i === diagrams.length - 1) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
    }
  }

  await worker.terminate();

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nDone. ${totalLabels} total labels across ${diagrams.length} diagrams.`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

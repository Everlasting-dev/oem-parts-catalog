/**
 * build-hotspots.js
 *
 * Merges data from two sources to populate clickable hotspots:
 *
 *   1. data/diagram-parts.json  (yoshiparts API: hotspot bboxes, part numbers)
 *   2. data/detected-labels.json (Tesseract OCR: label text + positions)
 *
 * Priority: API hotspot coordinates are preferred when available (they are
 * pixel-accurate).  OCR data fills in gaps.
 *
 * Also enriches the parts catalog with any part numbers found via scraping
 * that are not yet in catalog-data.json, and regenerates catalog-data.js.
 *
 * Run:  node scripts/build-hotspots.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');

const PROJECT_ROOT   = path.resolve(__dirname, '..');
const CATALOG_FILE   = path.join(PROJECT_ROOT, 'data', 'catalog-data.json');
const LABELS_FILE    = path.join(PROJECT_ROOT, 'data', 'detected-labels.json');
const PARTS_MAP_FILE = path.join(PROJECT_ROOT, 'data', 'diagram-parts.json');
const OVERRIDES_FILE = path.join(PROJECT_ROOT, 'data', 'diagram-overrides.json');
const JS_BUNDLE_FILE = path.join(PROJECT_ROOT, 'data', 'catalog-data.js');

// ── helpers ──────────────────────────────────────────────────────────────────

function load(fp) {
  if (!fs.existsSync(fp)) return null;
  let raw = fs.readFileSync(fp, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

function amayamaUrl(pn) {
  return `https://www.amayama.com/en/part/nissan/${pn.replace(/[-\s]/g, '').toLowerCase()}`;
}

function nissanPartsDealUrl(pn) {
  return `https://www.nissanpartsdeal.com/parts/${pn}.html`;
}

function normaliseTextKey(text) {
  if (!text) return '';
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isPlaceholderPartNumber(pn) {
  if (!pn) return true;
  const clean = pn.trim().toUpperCase();
  return (
    clean === 'YYYYY-YYYYY' ||
    clean === 'XXXXX-XXXXX' ||
    clean === 'ZZZZZ-ZZZZZ' ||
    /^Y+$/.test(clean.replace(/-/g, ''))
  );
}

function isPlaceholderDescription(name) {
  const clean = normaliseTextKey(name);
  return !clean || clean === 'kigou setsumei';
}

function normalisePartNumber(pn) {
  return (pn || '').trim().toUpperCase().replace(/\s+/g, '');
}

function dedupeLinks(links) {
  const seen = new Set();
  return (links || []).filter(link => {
    if (!link || !link.url) return false;
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

// ── image dimension cache ────────────────────────────────────────────────────

const dimCache = {};
async function getImageDimensions(imagePath) {
  if (dimCache[imagePath]) return dimCache[imagePath];
  const fullPath = path.join(PROJECT_ROOT, imagePath);
  if (!fs.existsSync(fullPath)) return { width: 1024, height: 560 };
  const meta = await sharp(fullPath).metadata();
  dimCache[imagePath] = { width: meta.width || 1024, height: meta.height || 560 };
  return dimCache[imagePath];
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const catalog   = load(CATALOG_FILE);
  const labelsMap = load(LABELS_FILE);
  const partsMap  = load(PARTS_MAP_FILE);
  const overrides = load(OVERRIDES_FILE) || {};

  if (!catalog) { console.error('Missing catalog-data.json'); process.exit(1); }
  if (!partsMap) { console.error('Missing diagram-parts.json — run scrape first'); process.exit(1); }

  const existingParts = new Map((catalog.parts || []).map(p => [p.partNumber, p]));

  let totalHotspots = 0;
  let newPartsAdded = 0;

  for (const diagram of catalog.diagrams || []) {
    const scraped   = partsMap[diagram.id]  || {};
    const ocrLabels = (labelsMap || {})[diagram.id] || [];
    const existingHotspots = Array.isArray(diagram.hotspots) ? diagram.hotspots : [];

    const apiHotspots = scraped.hotspots || {};
    const apiItems    = scraped.items    || [];
    const apiProducts = scraped.products || {};
    const hasScrapedData =
      Object.keys(apiHotspots).length > 0 ||
      apiItems.length > 0 ||
      Object.keys(apiProducts).length > 0;
    const isAmayamaOnlyDiagram =
      !hasScrapedData &&
      existingHotspots.length > 0 &&
      existingHotspots.every(h => h.source === 'amayama-html');

    if (isAmayamaOnlyDiagram) {
      if (overrides[diagram.id]) {
        Object.assign(diagram, overrides[diagram.id]);
      }
      totalHotspots += existingHotspots.length;
      console.log(`  ${diagram.id}: preserved ${existingHotspots.length} Amayama hotspots`);
      continue;
    }

    // Build refNumber → partNumber mapping via diagramItems + products
    const refToPartNumber = {};
    for (const item of apiItems) {
      const prod = apiProducts[item.itemId];
      if (prod && prod.number) {
        const pn = normalisePartNumber(prod.number);
        if (isPlaceholderPartNumber(pn) || isPlaceholderDescription(prod.name)) continue;
        refToPartNumber[item.refNumber] = { partNumber: pn, name: prod.name || '' };
      }
    }

    // Also map products that are themselves hotspot keys (hardware bolts etc.)
    for (const [refKey] of Object.entries(apiHotspots)) {
      if (refToPartNumber[refKey]) continue;
      // Try to find a product whose raw number (without hyphens) matches the refKey
      for (const prod of Object.values(apiProducts)) {
        if (isPlaceholderPartNumber(prod.number) || isPlaceholderDescription(prod.name)) continue;
        const rawNum = (prod.number || '').replace(/[-\s]/g, '').toUpperCase();
        if (rawNum === refKey.toUpperCase()) {
          const pn = normalisePartNumber(prod.number);
          refToPartNumber[refKey] = { partNumber: pn, name: prod.name || '' };
          break;
        }
      }
    }

    // Get image dimensions so we can convert pixel coords → %
    const dims = diagram.imagePath
      ? await getImageDimensions(diagram.imagePath)
      : { width: 1024, height: 560 };

    const hotspots = [];
    const usedRefs = new Set();

    // ── Pass 1: API hotspots (pixel-accurate) ──
    for (const [refKey, bboxes] of Object.entries(apiHotspots)) {
      if (!bboxes || bboxes.length === 0) continue;
      const mapping = refToPartNumber[refKey];
      if (!mapping) continue;

      // bboxes is an array of [x1, y1, x2, y2] — use the first one
      const [x1, y1, x2, y2] = bboxes[0];
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const xPct = Math.round(cx / dims.width  * 10000) / 100;
      const yPct = Math.round(cy / dims.height * 10000) / 100;

      hotspots.push({
        callout:    refKey,
        x:          xPct,
        y:          yPct,
        partNumber: mapping.partNumber,
        source:     'api',
      });
      usedRefs.add(refKey);

      ensurePart(existingParts, mapping.partNumber, mapping.name);
    }

    // ── Pass 2: OCR labels that weren't covered by API ──
    for (const label of ocrLabels) {
      // If the API already placed a hotspot with a matching ref, skip
      if (usedRefs.has(label.label)) continue;

      // Try to match OCR label to a refNumber in the API data
      let mapping = refToPartNumber[label.label];
      if (!mapping) {
        // Prefix match: OCR "15208A" → API ref "15208"
        for (const ref of Object.keys(refToPartNumber)) {
          if (label.label.startsWith(ref) || ref.startsWith(label.label)) {
            mapping = refToPartNumber[ref];
            break;
          }
        }
      }
      if (!mapping) continue;

      // Deduplicate: skip if a hotspot for the same part is already nearby
      const dup = hotspots.find(
        h => h.partNumber === mapping.partNumber &&
             Math.abs(h.x - label.x) < 3 && Math.abs(h.y - label.y) < 3
      );
      if (dup) continue;

      hotspots.push({
        callout:    label.label,
        x:          label.x,
        y:          label.y,
        partNumber: mapping.partNumber,
        source:     'ocr',
      });

      ensurePart(existingParts, mapping.partNumber, mapping.name);
    }

    // ── Pass 3: API parts with no hotspot/OCR match → grid at bottom ──
    const missingRefs = Object.keys(refToPartNumber).filter(ref => {
      const pn = refToPartNumber[ref].partNumber;
      return !hotspots.find(h => h.partNumber === pn);
    });

    if (missingRefs.length > 0) {
      const cols = 8;
      const xStart = 5, xStep = 11, yStart = 90, yStep = 4;
      missingRefs.forEach((ref, idx) => {
        const { partNumber, name } = refToPartNumber[ref];
        hotspots.push({
          callout:    ref,
          x:          xStart + (idx % cols) * xStep,
          y:          yStart + Math.floor(idx / cols) * yStep,
          partNumber,
          source:     'grid',
        });
        ensurePart(existingParts, partNumber, name);
      });
    }

    diagram.hotspots = hotspots;

    if (overrides[diagram.id]) {
      Object.assign(diagram, overrides[diagram.id]);
    }

    // Use the API image URL when available — it is the image the hotspot
    // coordinates were computed against, so it will always match exactly.
    if (scraped.imageUrl) {
      diagram.apiImageUrl = scraped.imageUrl;
    }

    totalHotspots += hotspots.length;
    console.log(`  ${diagram.id}: ${hotspots.length} hotspots (${Object.keys(apiHotspots).length} API, ${ocrLabels.length} OCR)`);
  }

  // ── Rebuild parts array and related-parts grouping ──
  catalog.parts = Array.from(existingParts.values());

  for (const part of catalog.parts) {
    part.partNumber = normalisePartNumber(part.partNumber);
    part.links = dedupeLinks(part.links);

    if (!part.links || part.links.length === 0) {
      part.links = [
        { url: amayamaUrl(part.partNumber), label: part.partNumber, sourceName: 'https://www.amayama.com/' },
        { url: nissanPartsDealUrl(part.partNumber), label: part.partNumber, sourceName: 'https://www.nissanpartsdeal.com/' },
      ];
    }

    if (!part.supplierUrl && part.links.length > 0) {
      part.supplierUrl = part.links[0].url;
    }
  }

  catalog.parts = catalog.parts.filter(part =>
    !isPlaceholderPartNumber(part.partNumber) &&
    !isPlaceholderDescription(part.description)
  );

  const byDesc = new Map();
  for (const part of catalog.parts) {
    const key = normaliseTextKey(part.description);
    if (!key) continue;
    if (!byDesc.has(key)) byDesc.set(key, []);
    byDesc.get(key).push(part.partNumber);
  }
  for (const part of catalog.parts) {
    const key = normaliseTextKey(part.description);
    part.relatedPartNumbers = key
      ? (byDesc.get(key) || []).filter(pn => pn !== part.partNumber)
      : [];
  }

  // ── Write outputs ──
  const jsonStr = JSON.stringify(catalog, null, 2);
  fs.writeFileSync(CATALOG_FILE, jsonStr, 'utf8');
  fs.writeFileSync(JS_BUNDLE_FILE, `window.CATALOG_DATA = ${jsonStr}\n`, 'utf8');

  console.log('\n=== build-hotspots complete ===');
  console.log(`  Total hotspots    : ${totalHotspots}`);
  console.log(`  New parts added   : ${newPartsAdded}`);
  console.log(`  Total parts       : ${catalog.parts.length}`);

  function ensurePart(map, pn, name) {
    if (isPlaceholderPartNumber(pn) || isPlaceholderDescription(name)) return;
    if (map.has(pn)) return;
    const links = [
      { url: amayamaUrl(pn), label: pn, sourceName: 'https://www.amayama.com/' },
      { url: nissanPartsDealUrl(pn), label: pn, sourceName: 'https://www.nissanpartsdeal.com/' },
    ];
    map.set(pn, {
      partNumber: pn, description: name || '',
      appliesDetails: '', period: '', requiredQty: '', priceAed: '',
      status: '', notes: '',
      supplierUrl: amayamaUrl(pn), links, relatedPartNumbers: [],
    });
    newPartsAdded++;
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

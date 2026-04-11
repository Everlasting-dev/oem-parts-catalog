/**
 * parse-amayama-html.js
 *
 * Imports a saved Amayama EPC HTML page into the local catalog.
 *
 * What it does:
 * - Parses every visible schema variant on the page
 * - Extracts the local saved PNG from the sibling "_files" folder
 * - Reads image-map coordinates and converts them to hotspot percentages
 * - Extracts the per-variant parts table
 * - Merges parts into data/catalog-data.json
 * - Replaces older imported diagrams from the same Amayama page
 *
 * Usage:
 *   node scripts/parse-amayama-html.js <path-to-saved-html>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { writeCatalogBundles } = require('./write-catalog-bundles');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CATALOG_FILE = path.join(PROJECT_ROOT, 'data', 'catalog-data.json');
const DIAGRAMS_DIR = path.join(PROJECT_ROOT, 'assets', 'diagrams');

const htmlPath = process.argv[2];
if (!htmlPath || !fs.existsSync(htmlPath)) {
  console.error('Usage: node scripts/parse-amayama-html.js <path-to-saved-html>');
  process.exit(1);
}

function loadJson(fp) {
  let raw = fs.readFileSync(fp, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const JP_TO_EN = {
  'エンジンカバーパーツ': 'Engine Cover',
  'インテークパーツ':     'Intake Manifold',
  'エキゾーストパーツ':   'Exhaust Manifold',
  'エキゾースト':         'Exhaust',
  'インテーク':           'Intake',
  'エンジン':             'Engine',
  'フロント':             'Front',
  'リア':                 'Rear',
  'ブレーキ':             'Brake',
  'サスペンション':       'Suspension',
  'ステアリング':         'Steering',
  'トランスミッション':   'Transmission',
  'クーリング':           'Cooling',
  'フューエル':           'Fuel',
};

function translateJp(text) {
  let out = String(text || '');
  for (const [jp, en] of Object.entries(JP_TO_EN)) {
    out = out.replace(jp, en);
  }
  return out;
}

function normaliseTextKey(text) {
  return decodeEntities(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugify(text) {
  return decodeEntities(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function amayamaUrl(pn) {
  return `https://www.amayama.com/en/part/nissan/${pn.replace(/[-\s]/g, '').toLowerCase()}`;
}

function normalizePartNumber(value) {
  const raw = decodeEntities(value || '').toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z0-9]{5}-[A-Z0-9]{4,6}$/.test(raw)) return raw;
  if (/^[A-Z0-9]{10,11}$/.test(raw)) return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  return '';
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function inferViewFamily(pageTitle, sourceUrl) {
  const haystack = `${pageTitle} ${sourceUrl}`.toLowerCase();
  if (/vacuum piping|canister|evap/.test(haystack)) {
    return {
      id: 'evap-vacuum-canister',
      title: 'EVAP System / Vacuum Piping & Canister',
    };
  }
  return {
    id: `family-${slugify(pageTitle)}`,
    title: decodeEntities(pageTitle),
  };
}

function parseMetaFromAlt(altText) {
  const meta = {
    applies: '',
    specification: '',
    period: '',
  };

  const applies = altText.match(/Applies:\s*([^;]+)/i);
  const specification = altText.match(/Specification:\s*([^;]+)/i);
  const period = altText.match(/Period:\s*([^;]+)/i);

  if (applies) meta.applies = decodeEntities(applies[1]);
  if (specification) meta.specification = decodeEntities(specification[1]);
  if (period) meta.period = decodeEntities(period[1]);

  return meta;
}

function parseSizeFromStyle(styleText) {
  const width = styleText.match(/width:\s*([0-9.]+)px/i);
  const height = styleText.match(/height:\s*([0-9.]+)px/i);
  return {
    width: width ? parseFloat(width[1]) : 0,
    height: height ? parseFloat(height[1]) : 0,
  };
}

function copyLocalImage(htmlFilePath, relativeSrc, destinationBaseName) {
  if (!relativeSrc) return '';

  const decodedSrc = decodeEntities(relativeSrc).replace(/^\.\//, '');
  if (/^https?:\/\//i.test(decodedSrc)) return '';
  const sourcePath = path.resolve(path.dirname(htmlFilePath), decodedSrc);
  if (!fs.existsSync(sourcePath)) return '';

  ensureDir(DIAGRAMS_DIR);
  const ext = path.extname(sourcePath) || '.png';
  const destinationPath = path.join(DIAGRAMS_DIR, `${destinationBaseName}${ext}`);
  fs.copyFileSync(sourcePath, destinationPath);

  return path.relative(PROJECT_ROOT, destinationPath).replace(/\\/g, '/');
}

function resolveImageUrl(relativeOrAbsoluteSrc, sourceUrl) {
  const decodedSrc = decodeEntities(relativeOrAbsoluteSrc || '').trim();
  if (!decodedSrc) return '';
  if (/^https?:\/\//i.test(decodedSrc)) return decodedSrc;
  if (!sourceUrl) return '';
  try {
    return new URL(decodedSrc, sourceUrl).toString();
  } catch {
    return '';
  }
}

function extractPartDescription(linkTitle, fallbackText) {
  const cleanTitle = decodeEntities(linkTitle || '');
  const match = cleanTitle.match(/^Genuine Nissan [A-Z0-9-]+\s*-\s*(.+)$/i);
  if (match) return match[1].trim();
  return decodeEntities(fallbackText || '');
}

function addOrMergePart(targetMap, part) {
  if (!targetMap.has(part.partNumber)) {
    targetMap.set(part.partNumber, part);
    return;
  }

  const existing = targetMap.get(part.partNumber);
  if (!existing.description && part.description) existing.description = part.description;
  if (!existing.period && part.period) existing.period = part.period;
  if (!existing.requiredQty && part.requiredQty) existing.requiredQty = part.requiredQty;
  if (!existing.appliesDetails && part.appliesDetails) existing.appliesDetails = part.appliesDetails;
  if (!existing.notes && part.notes) existing.notes = part.notes;

  existing.links = existing.links || [];
  const urls = new Set(existing.links.map(link => link.url));
  for (const link of part.links || []) {
    if (!urls.has(link.url)) {
      existing.links.push(link);
      urls.add(link.url);
    }
  }

  if (!existing.supplierUrl && existing.links.length > 0) {
    existing.supplierUrl = existing.links[0].url;
  }
}

const raw = fs.readFileSync(htmlPath, 'utf8');
const $ = cheerio.load(raw, { decodeEntities: false });

const titleText = $('title').first().text();
const pageTitle = titleText
  ? decodeEntities(titleText.split(' for ')[0])
  : path.basename(htmlPath, '.html');

// fileSlug is unique per HTML file (uses filename, not just page title) so
// multiple files for the same system (e.g. different model year ranges) never
// overwrite each other's diagrams.
// Compact format: systemSlug (≤35) + year range + grade
// e.g. "anti-skid-control-chassis-11-2007-11-2013-black"
const fileSlug = (() => {
  const fname = path.basename(htmlPath, path.extname(htmlPath));
  const yearRange = fname.match(/(\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{4})/);
  const gradeMatch = fname.match(/\d{2}\.\d{4}\s+([A-Z][A-Z0-9]*)/);
  const systemSlug = slugify(pageTitle).slice(0, 35).replace(/-+$/, '');
  const yearPart = yearRange ? slugify(`${yearRange[1]}-${yearRange[2]}`) : '';
  const gradePart = gradeMatch ? gradeMatch[1].toLowerCase() : '';
  return [systemSlug, yearPart, gradePart].filter(Boolean).join('-').slice(0, 80);
})();

const srcMatch = raw.match(/saved from url=\(0\d+\)(https?:\/\/[^\s)]+)/i);
const sourceUrl = srcMatch ? srcMatch[1] : '';
const viewFamily = inferViewFamily(pageTitle, sourceUrl);

const catalog = loadJson(CATALOG_FILE);
const existingParts = new Map((catalog.parts || []).map(part => [part.partNumber, part]));
const importedParts = new Map();
const importedDiagrams = [];

$('.epcSchema__schema').each((schemaIndex, schemaEl) => {
  const schema = $(schemaEl);
  const schemaId = decodeEntities(schema.attr('data-id') || `schema-${schemaIndex + 1}`);
  const image = schema.find('img[usemap]').first();
  if (!image.length) return;

  const usemap = decodeEntities(image.attr('usemap') || '').replace(/^#/, '');
  const altText = decodeEntities(image.attr('alt') || '');
  const meta = parseMetaFromAlt(altText);
  const imgWrapStyle = schema.find('.imgMap').attr('style') || '';
  const dims = parseSizeFromStyle(imgWrapStyle);
  const imgWidth = dims.width || parseFloat(image.attr('width') || '1280') || 1280;
  const imgHeight = dims.height || parseFloat(image.attr('height') || '640') || 640;

  const imagePath = copyLocalImage(
    htmlPath,
    image.attr('src') || '',
    `amayama-${fileSlug}-${slugify(schemaId)}`
  );
  const resolvedImageUrl = resolveImageUrl(image.attr('src') || '', sourceUrl);

  const refToPartNumbers = new Map();
  let currentRef = '';

  schema.find('table.entriesTable tr').each((_, rowEl) => {
    const row = $(rowEl);
    const headerCell = row.find('.entriesPncTable__groupHeader').first();
    if (headerCell.length) {
      const headerText = decodeEntities(headerCell.text());
      const match = headerText.match(/^([A-Z0-9+]+)\s*-\s*(.+)$/i);
      currentRef = match ? match[1].trim() : headerText.trim();
      return;
    }

    const link = row.find('.entriesTable__number a').first();
    const numberCellText = decodeEntities(row.find('.entriesTable__number').first().text());
    const partNumber = normalizePartNumber(link.length ? link.text() : numberCellText);
    if (!partNumber) return;

    const description = extractPartDescription(
      link.attr('title') || '',
      row.find('.entriesTable__description').text()
    );
    const descriptionCell = decodeEntities(row.find('.entriesTable__description').text());
    const period = decodeEntities(row.find('.entriesTable__period').text());
    const requiredQty = decodeEntities(row.find('.entriesTable__required').text());
    const appliesMatch = descriptionCell.match(/Applies:\s*([^;]+)/i);
    const notesMatch = descriptionCell.match(/Notes:\s*([^;]+)/i);

    const part = {
      partNumber,
      description,
      ref: currentRef,
      appliesDetails: appliesMatch ? decodeEntities(appliesMatch[1]) : (meta.applies || ''),
      period: period || meta.period || '',
      requiredQty,
      notes: notesMatch ? decodeEntities(notesMatch[1]) : '',
      supplierUrl: amayamaUrl(partNumber),
      links: [
        {
          url: amayamaUrl(partNumber),
          label: partNumber,
          sourceName: 'https://www.amayama.com/',
        },
      ],
      relatedPartNumbers: [],
      source: 'amayama-html',
    };

    addOrMergePart(importedParts, part);

    const rowKey = decodeEntities(row.attr('data-key') || '');
    const rowRefMatch = rowKey.match(new RegExp(`^${schemaId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-([A-Z0-9+]+)$`, 'i'));
    const rowRef = rowRefMatch ? rowRefMatch[1] : currentRef;

    if (rowRef) {
      if (!refToPartNumbers.has(rowRef)) refToPartNumbers.set(rowRef, []);
      const list = refToPartNumbers.get(rowRef);
      if (!list.includes(partNumber)) list.push(partNumber);
    }
  });

  const hotspotSeen = new Set();
  const hotspots = [];
  $(`map[name="${usemap}"] area`).each((_, areaEl) => {
    const area = $(areaEl);
    const dataKey = decodeEntities(area.attr('data-key') || '');
    const coordsText = decodeEntities(area.attr('coords') || '');
    if (!dataKey || !coordsText) return;

    const refMatch = dataKey.match(new RegExp(`^${schemaId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-([A-Z0-9+]+)$`, 'i'));
    if (!refMatch) return;
    const callout = refMatch[1];
    const partNumbers = refToPartNumbers.get(callout) || [];
    if (!partNumbers.length) return;

    const nums = coordsText.split(',').map(n => parseFloat(n.trim())).filter(n => !Number.isNaN(n));
    if (nums.length < 4) return;

    const x = Math.round((((nums[0] + nums[2]) / 2) / imgWidth) * 10000) / 100;
    const y = Math.round((((nums[1] + nums[3]) / 2) / imgHeight) * 10000) / 100;

    for (const partNumber of partNumbers) {
      const key = `${callout}|${partNumber}`;
      if (hotspotSeen.has(key)) continue;
      hotspotSeen.add(key);
      hotspots.push({
        callout,
        partNumber,
        x,
        y,
        source: 'amayama-html',
      });
    }
  });

  const subtitleBits = [];
  if (meta.specification) subtitleBits.push(translateJp(meta.specification));
  if (meta.period) subtitleBits.push(meta.period);
  if (meta.applies) subtitleBits.push(meta.applies);

  importedDiagrams.push({
    id: `amayama-${fileSlug}-${slugify(schemaId)}`,
    title: decodeEntities(pageTitle),
    subtitle: subtitleBits.join(' • ') || 'Imported from Amayama',
    sourceUrl,
    imagePath,
    apiImageUrl: imagePath ? '' : resolvedImageUrl,
    hotspots,
    source: 'amayama-html',
    sourceVariantId: schemaId,
    viewFamilyId: viewFamily.id,
    viewFamilyTitle: viewFamily.title,
  });
});

if (importedDiagrams.length === 0) {
  console.error('No schema variants found. Check that the HTML file is a valid Amayama catalog page.');
  process.exit(1);
}

let added = 0;
let updated = 0;
for (const part of importedParts.values()) {
  if (existingParts.has(part.partNumber)) {
    const existing = existingParts.get(part.partNumber);
    if (part.description && (!existing.description || existing.source === 'amayama-html')) {
      existing.description = part.description;
      updated++;
    }
    if (part.period && !existing.period) existing.period = part.period;
    if (part.requiredQty && !existing.requiredQty) existing.requiredQty = part.requiredQty;
    if (part.appliesDetails && !existing.appliesDetails) existing.appliesDetails = part.appliesDetails;

    existing.links = existing.links || [];
    const existingUrls = new Set(existing.links.map(link => link.url));
    for (const link of part.links) {
      if (!existingUrls.has(link.url)) {
        existing.links.unshift(link);
        existingUrls.add(link.url);
      }
    }
    if (!existing.supplierUrl && existing.links.length > 0) {
      existing.supplierUrl = existing.links[0].url;
    }
  } else {
    existingParts.set(part.partNumber, part);
    added++;
  }
}

// Use fileSlug so each HTML file has a unique prefix — multiple HTML files
// for the same system (different year ranges) coexist without overwriting each other.
const idPrefix = `amayama-${fileSlug}-`;
catalog.diagrams = (catalog.diagrams || []).filter(diagram => {
  if (diagram.id.startsWith(idPrefix)) return false;
  if (sourceUrl && diagram.sourceUrl === sourceUrl) return false;
  return true;
});
catalog.diagrams.push(...importedDiagrams);

catalog.parts = Array.from(existingParts.values());
const byDesc = new Map();
for (const part of catalog.parts) {
  const key = normaliseTextKey(part.description);
  if (!key) continue;
  if (!byDesc.has(key)) byDesc.set(key, []);
  byDesc.get(key).push(part.partNumber);
}
for (const part of catalog.parts) {
  const key = normaliseTextKey(part.description);
  part.relatedPartNumbers = key ? (byDesc.get(key) || []).filter(pn => pn !== part.partNumber) : [];
}

const jsonStr = JSON.stringify(catalog, null, 2);
fs.writeFileSync(CATALOG_FILE, jsonStr, 'utf8');
writeCatalogBundles(catalog, { projectRoot: PROJECT_ROOT });

console.log(`Parsed "${pageTitle}"`);
console.log(`  Source URL     : ${sourceUrl || '(not found)'}`);
console.log(`  Variants added : ${importedDiagrams.length}`);
console.log(`  New parts      : ${added}`);
console.log(`  Existing fixed : ${updated}`);
console.log(`  Total parts    : ${catalog.parts.length}`);
console.log(`  Total diagrams : ${catalog.diagrams.length}`);

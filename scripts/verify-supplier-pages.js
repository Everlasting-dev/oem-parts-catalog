'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CATALOG_FILE = path.join(PROJECT_ROOT, 'data', 'catalog-data.json');
const JS_BUNDLE_FILE = path.join(PROJECT_ROOT, 'data', 'catalog-data.js');
const REPORT_JSON = path.join(PROJECT_ROOT, 'data', 'supplier-verification.json');
const REPORT_MD = path.join(PROJECT_ROOT, 'data', 'supplier-verification.md');

const STOP_WORDS = new Set([
  'system', 'parts', 'part', 'control', 'engine', 'piping', 'pipe', 'vacuum',
  'canister', 'emission', 'evap', 'hose', 'nissan', 'gtr', 'gt', 'r35',
  'diagram', 'view', 'fuel', 'assembly', 'kit', 'model', 'specification',
  'app', 'vr38dett', 'year', 'online', 'genuine', 'catalogue', 'catalog'
]);

const SUBSYSTEM_KEYWORDS = [
  'vacuum', 'canister', 'evap', 'emission', 'fuel', 'pump', 'cooler', 'radiator',
  'brake', 'suspension', 'transmission', 'transfer', 'exhaust', 'turbo', 'intake',
  'wiring', 'controller', 'steering', 'door', 'bumper', 'lamp', 'clutch'
];

function loadJson(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

function saveCatalog(catalog) {
  const json = JSON.stringify(catalog, null, 2);
  fs.writeFileSync(CATALOG_FILE, `${json}\n`, 'utf8');
  fs.writeFileSync(JS_BUNDLE_FILE, `window.CATALOG_DATA = ${json}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = {
    family: '',
    limit: 0,
    offset: 0,
    write: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--family') options.family = String(argv[i + 1] || '').trim();
    if (arg === '--limit') options.limit = Number(argv[i + 1] || 0);
    if (arg === '--offset') options.offset = Number(argv[i + 1] || 0);
    if (arg === '--write') options.write = true;
  }

  if (!options.family) {
    console.error('Usage: node scripts/verify-supplier-pages.js --family <view-family-id> [--offset 0] [--limit 25] [--write]');
    process.exit(1);
  }

  return options;
}

function normaliseText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normaliseText(text)
    .split(' ')
    .filter(token => token && token.length > 2 && !STOP_WORDS.has(token));
}

function pickCatalogLabel(payload) {
  const text = [payload.catalogLabel, payload.h1, payload.title].filter(Boolean).join(' ');
  return text.trim();
}

function classifyMatch(family, payload) {
  const targetText = [
    family.title,
    ...family.variants.map(variant => variant.title),
    ...family.variants.map(variant => variant.subtitle || ''),
  ].join(' ');
  const sourceText = [payload.catalogLabel, payload.h1, payload.title].filter(Boolean).join(' ');

  const targetTokens = new Set(tokenize(targetText));
  const sourceTokens = new Set(tokenize(sourceText));
  const shared = [...targetTokens].filter(token => sourceTokens.has(token));
  const sourceSubsystems = SUBSYSTEM_KEYWORDS.filter(token => sourceTokens.has(token));
  const targetSubsystems = SUBSYSTEM_KEYWORDS.filter(token => targetTokens.has(token));
  const foreignSubsystems = sourceSubsystems.filter(token => !targetSubsystems.includes(token));

  if (shared.length >= 2) {
    return { status: 'matched', shared, foreignSubsystems };
  }

  if (shared.length >= 1 && foreignSubsystems.length === 0) {
    return { status: 'matched', shared, foreignSubsystems };
  }

  if (foreignSubsystems.length > 0 && shared.length === 0) {
    return { status: 'suspicious', shared, foreignSubsystems };
  }

  return { status: 'review', shared, foreignSubsystems };
}

function buildFamily(catalog, familyId) {
  const variants = (catalog.diagrams || []).filter(diagram => diagram.viewFamilyId === familyId || diagram.id === familyId);
  if (variants.length === 0) {
    console.error(`No diagrams found for family "${familyId}"`);
    process.exit(1);
  }

  const title = variants[0].viewFamilyTitle || variants[0].title;
  const partNumbers = [...new Set(
    variants.flatMap(variant => (variant.hotspots || []).map(hotspot => hotspot.partNumber).filter(Boolean))
  )];

  return { id: familyId, title, variants, partNumbers };
}

async function fetchSupplierPayload(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);

  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const img = document.querySelector('img.scheme, img[src*="schema"], img');
    const catalogMatch = text.match(/Catalog\s+([^\n]+?)(?:\s+More|\s*$)/i);

    return {
      title: document.title || '',
      h1: document.querySelector('h1')?.textContent?.trim() || '',
      catalogLabel: catalogMatch ? catalogMatch[1].trim() : '',
      imageUrl: img?.src || '',
    };
  });
}

async function inspectPart(page, part, family) {
  const result = {
    partNumber: part.partNumber,
    description: part.description || '',
    supplierUrl: part.supplierUrl || part.links?.[0]?.url || '',
    status: 'review',
    sharedTokens: [],
    foreignSubsystems: [],
    supplierTitle: '',
    supplierHeading: '',
    supplierCatalogLabel: '',
    supplierImageUrl: '',
    error: '',
  };

  if (!result.supplierUrl || !/amayama\.com/.test(result.supplierUrl)) {
    result.status = 'skipped';
    result.error = 'Unsupported or missing supplier URL';
    return result;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const payload = await fetchSupplierPayload(page, result.supplierUrl);

      if (/just a moment/i.test(payload.title) || payload.h1 === 'www.amayama.com') {
        throw new Error('Supplier page blocked by anti-bot challenge');
      }

      result.supplierTitle = payload.title;
      result.supplierHeading = payload.h1;
      result.supplierCatalogLabel = payload.catalogLabel || pickCatalogLabel(payload);
      result.supplierImageUrl = payload.imageUrl;

      const classification = classifyMatch(family, payload);
      result.status = classification.status;
      result.sharedTokens = classification.shared;
      result.foreignSubsystems = classification.foreignSubsystems;
      return result;
    } catch (error) {
      result.error = error.message;
      if (attempt < 3) {
        await sleep(4000 * attempt);
      }
    }
  }

  return result;
}

function renderMarkdown(report) {
  return [
    '# Supplier Verification',
    '',
    `- Family: ${report.familyTitle} (${report.familyId})`,
    `- Checked: ${report.summary.checked}`,
    `- Matched: ${report.summary.matched}`,
    `- Needs review: ${report.summary.review}`,
    `- Suspicious: ${report.summary.suspicious}`,
    `- Skipped: ${report.summary.skipped}`,
    '',
    '## Suspicious Or Review',
    ...report.results
      .filter(item => item.status === 'suspicious' || item.status === 'review')
      .map(item => `- ${item.partNumber} | ${item.status} | ${item.supplierCatalogLabel || item.supplierHeading || item.error}`),
    '',
    '## Matched',
    ...report.results
      .filter(item => item.status === 'matched')
      .slice(0, 50)
      .map(item => `- ${item.partNumber} | ${item.supplierCatalogLabel || item.supplierHeading}`),
  ].join('\n');
}

function buildReport(family, results) {
  return {
    generatedAt: new Date().toISOString(),
    familyId: family.id,
    familyTitle: family.title,
    summary: {
      checked: results.length,
      matched: results.filter(item => item.status === 'matched').length,
      review: results.filter(item => item.status === 'review').length,
      suspicious: results.filter(item => item.status === 'suspicious').length,
      skipped: results.filter(item => item.status === 'skipped').length,
    },
    results,
  };
}

function writeReport(report) {
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(REPORT_MD, `${renderMarkdown(report)}\n`, 'utf8');
}

function loadExistingResults(familyId) {
  if (!fs.existsSync(REPORT_JSON)) return [];
  try {
    const existing = loadJson(REPORT_JSON);
    if (existing.familyId !== familyId || !Array.isArray(existing.results)) return [];
    return existing.results;
  } catch {
    return [];
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalog = loadJson(CATALOG_FILE);
  const family = buildFamily(catalog, options.family);
  const partMap = new Map((catalog.parts || []).map(part => [part.partNumber, part]));

  let candidateParts = family.partNumbers
    .map(partNumber => partMap.get(partNumber))
    .filter(Boolean)
    .filter(part => part.supplierUrl || part.links?.[0]?.url);

  if (options.offset > 0) {
    candidateParts = candidateParts.slice(options.offset);
  }

  if (options.limit > 0) {
    candidateParts = candidateParts.slice(0, options.limit);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  const resultsMap = new Map(loadExistingResults(family.id).map(item => [item.partNumber, item]));
  for (let index = 0; index < candidateParts.length; index += 1) {
    const part = candidateParts[index];
    const result = await inspectPart(page, part, family);
    resultsMap.set(result.partNumber, result);
    const report = buildReport(family, [...resultsMap.values()]);
    writeReport(report);
    console.log(`[${index + 1}/${candidateParts.length}] ${part.partNumber} -> ${result.status}`);
    await sleep(1500);
  }

  await browser.close();

  const report = buildReport(family, [...resultsMap.values()]);
  writeReport(report);

  if (options.write) {
    const checkedAt = report.generatedAt;
    for (const item of report.results) {
      const part = partMap.get(item.partNumber);
      if (!part) continue;

      part.supplierPreviewImage = item.supplierImageUrl || part.supplierPreviewImage || '';
      part.supplierCatalogLabel = item.supplierCatalogLabel || part.supplierCatalogLabel || '';
      part.supplierPageTitle = item.supplierTitle || part.supplierPageTitle || '';
      part.supplierVerification = {
        checkedAt,
        familyId: family.id,
        familyTitle: family.title,
        status: item.status,
        sharedTokens: item.sharedTokens,
        foreignSubsystems: item.foreignSubsystems,
        error: item.error,
      };
    }

    saveCatalog(catalog);
  }

  console.log(`Verification written to ${REPORT_JSON}`);
  console.log(`Verification written to ${REPORT_MD}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

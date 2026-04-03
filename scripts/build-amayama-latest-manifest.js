'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(PROJECT_ROOT, 'amayama latest');
const OUTPUT_JSON = path.join(PROJECT_ROOT, 'data', 'amayama-latest.json');
const OUTPUT_JS = path.join(PROJECT_ROOT, 'data', 'amayama-latest.js');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

function decode(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripCatalogSuffix(title) {
  return decode(title)
    .replace(/\s*-\s*Nissan [^-]+ Car and Auto Spare Parts\s*-\s*Genuine Online Car Parts Catalogue\s*-\s*Amayama\s*$/i, '')
    .trim();
}

function buildSummary(raw) {
  const $ = cheerio.load(raw, { decodeEntities: false });
  const title = stripCatalogSuffix($('title').first().text() || '');
  const heading = decode($('h1').first().text() || '').trim();
  const breadcrumb = decode($('.breadcrumbs__last-item, .epcBreadcrumbs li:last-child').first().text() || '').trim();
  const schemaCount = $('.epcSchema__schema').length;
  const imageCount = $('.epcSchema__schema img').length;
  const tableCount = $('table.entriesTable').length;
  const heroImage =
    $('.epcSchema__schema img').first().attr('src') ||
    $('img').filter((_, el) => /schema|diagram/i.test($(el).attr('src') || '')).first().attr('src') ||
    '';

  return {
    title,
    heading: heading || title,
    breadcrumb,
    schemaCount,
    imageCount,
    tableCount,
    heroImage,
  };
}

function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Missing folder: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(SOURCE_DIR).sort((a, b) => a.localeCompare(b));
  const htmlFiles = entries.filter(name => name.toLowerCase().endsWith('.html'));
  const assetDirs = entries.filter(name => name.endsWith('_files'));

  const pages = htmlFiles.map((name, index) => {
    const absolutePath = path.join(SOURCE_DIR, name);
    const raw = fs.readFileSync(absolutePath, 'utf8');
    const summary = buildSummary(raw);
    return {
      id: `${String(index + 1).padStart(3, '0')}-${slugify(summary.heading || path.basename(name, '.html'))}`,
      available: true,
      fileName: name,
      path: path.relative(PROJECT_ROOT, absolutePath).replace(/\\/g, '/'),
      title: summary.title || path.basename(name, '.html'),
      heading: summary.heading || summary.title || path.basename(name, '.html'),
      breadcrumb: summary.breadcrumb,
      schemaCount: summary.schemaCount,
      imageCount: summary.imageCount,
      tableCount: summary.tableCount,
      heroImage: summary.heroImage,
    };
  });

  const existingBases = new Set(pages.map(page => page.fileName.replace(/\.html$/i, '')));
  const missingPages = assetDirs
    .map(name => name.replace(/_files$/, ''))
    .filter(baseName => !existingBases.has(baseName))
    .map((baseName, index) => ({
      id: `missing-${String(index + 1).padStart(3, '0')}-${slugify(baseName)}`,
      available: false,
      fileName: `${baseName}.html`,
      path: '',
      title: stripCatalogSuffix(baseName),
      heading: stripCatalogSuffix(baseName),
      breadcrumb: 'Assets folder exists, but the saved HTML page is missing',
      schemaCount: 0,
      imageCount: 0,
      tableCount: 0,
      heroImage: '',
    }));

  const allPages = [...pages, ...missingPages].sort((a, b) => a.heading.localeCompare(b.heading));

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceDir: path.relative(PROJECT_ROOT, SOURCE_DIR).replace(/\\/g, '/'),
    pageCount: allPages.length,
    availableCount: pages.length,
    missingCount: missingPages.length,
    pages: allPages,
  };

  const json = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(OUTPUT_JSON, `${json}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_JS, `window.AMAYAMA_LATEST_MANIFEST = ${json}\n`, 'utf8');

  console.log(`Manifest written: ${path.relative(PROJECT_ROOT, OUTPUT_JSON).replace(/\\/g, '/')}`);
  console.log(`Pages indexed: ${allPages.length}`);
  console.log(`Available HTML pages: ${pages.length}`);
  console.log(`Missing HTML pages: ${missingPages.length}`);
}

main();

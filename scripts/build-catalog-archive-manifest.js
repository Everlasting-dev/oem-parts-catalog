'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE_DIR = path.join(PROJECT_ROOT, 'data', 'amayama-pages', 'nissan-usa-gt-r-r35-614-vr38dett');
const OUTPUT_JSON = path.join(PROJECT_ROOT, 'data', 'catalog-archive.json');
const OUTPUT_JS = path.join(PROJECT_ROOT, 'data', 'catalog-archive.js');

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') {
      options.source = path.resolve(PROJECT_ROOT, String(argv[index + 1] || '').trim());
    }
  }

  return options;
}

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

function cleanTitle(text) {
  return decode(text)
    .replace(/\s*-\s*Nissan [^-]+ Car and Auto Spare Parts\s*-\s*Genuine Online Car Parts Catalogue\s*-\s*Amayama\s*$/i, '')
    .trim();
}

function buildSummary(raw, fileName) {
  const $ = cheerio.load(raw, { decodeEntities: false });
  const title = cleanTitle($('title').first().text() || path.basename(fileName, '.html'));
  const heading = decode($('h1').first().text() || title).trim() || title;
  const breadcrumb = decode($('.breadcrumbs__last-item, .epcBreadcrumbs li:last-child').first().text() || '').trim();
  const schemaCount = $('.epcSchema__schema').length;
  const imageCount = $('.epcSchema__schema img').length;
  const tableCount = $('table.entriesTable').length;
  const pageText = decode($('body').text() || '');
  const isVerificationWall = /captcha|unusual activity|verify|not a bot/i.test(pageText);
  const heroImage =
    $('.epcSchema__schema img').first().attr('src') ||
    $('img').filter((_, el) => /schema|diagram/i.test($(el).attr('src') || '')).first().attr('src') ||
    '';

  return {
    title,
    heading,
    breadcrumb,
    schemaCount,
    imageCount,
    tableCount,
    heroImage,
    isVerificationWall,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceDir = options.source;

  if (!fs.existsSync(sourceDir)) {
    console.error(`Missing source folder: ${sourceDir}`);
    process.exit(1);
  }

  const htmlFiles = fs.readdirSync(sourceDir)
    .filter(name => name.toLowerCase().endsWith('.html') && name !== '000-root.html')
    .sort((a, b) => a.localeCompare(b));

  const pages = htmlFiles.map((fileName, index) => {
    const absolutePath = path.join(sourceDir, fileName);
    const raw = fs.readFileSync(absolutePath, 'utf8');
    const summary = buildSummary(raw, fileName);
    return {
      id: `${String(index + 1).padStart(3, '0')}-${slugify(summary.heading || summary.title || fileName)}`,
      available: !summary.isVerificationWall,
      fileName,
      path: path.relative(PROJECT_ROOT, absolutePath).replace(/\\/g, '/'),
      title: summary.title,
      heading: summary.heading,
      breadcrumb: summary.breadcrumb,
      schemaCount: summary.schemaCount,
      imageCount: summary.imageCount,
      tableCount: summary.tableCount,
      heroImage: summary.heroImage,
      type: summary.isVerificationWall ? 'verification' : 'section',
    };
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceDir: path.relative(PROJECT_ROOT, sourceDir).replace(/\\/g, '/'),
    pageCount: pages.length,
    availableCount: pages.filter(page => page.available).length,
    unavailableCount: pages.filter(page => !page.available).length,
    pages,
  };

  const json = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(OUTPUT_JSON, `${json}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_JS, `window.CATALOG_ARCHIVE_MANIFEST = ${json}\n`, 'utf8');

  console.log(`Manifest written: ${path.relative(PROJECT_ROOT, OUTPUT_JSON).replace(/\\/g, '/')}`);
  console.log(`Pages indexed: ${manifest.pageCount}`);
  console.log(`Available pages: ${manifest.availableCount}`);
  console.log(`Unavailable pages: ${manifest.unavailableCount}`);
}

main();

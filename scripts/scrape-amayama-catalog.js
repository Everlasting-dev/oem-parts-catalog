'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_ROOT = path.join(PROJECT_ROOT, 'data', 'amayama-pages');

function parseArgs(argv) {
  const options = {
    url: '',
    outDir: '',
    limit: 0,
    headless: true,
    waitMs: 0,
    userDataDir: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') && !options.url) {
      options.url = arg.trim();
      continue;
    }
    if (arg === '--out') options.outDir = String(argv[i + 1] || '').trim();
    if (arg === '--limit') options.limit = Number(argv[i + 1] || 0);
    if (arg === '--headless') options.headless = true;
    if (arg === '--headed') options.headless = false;
    if (arg === '--wait-ms') options.waitMs = Number(argv[i + 1] || 0);
    if (arg === '--user-data-dir') options.userDataDir = String(argv[i + 1] || '').trim();
  }

  if (!options.url) {
    console.error('Usage: node scripts/scrape-amayama-catalog.js <catalog-root-url> [--out data/amayama-pages/latest] [--limit 50]');
    process.exit(1);
  }

  return options;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

function sanitizeFileName(text) {
  return slugify(text) || 'page';
}

function pad(num) {
  return String(num).padStart(3, '0');
}

function resolveOutputDir(url, explicitOutDir) {
  if (explicitOutDir) return path.resolve(PROJECT_ROOT, explicitOutDir);
  const parsed = new URL(url);
  const tail = parsed.pathname.split('/').filter(Boolean).slice(-4).join('-');
  return path.join(DEFAULT_OUTPUT_ROOT, sanitizeFileName(tail || 'catalog'));
}

function saveHtmlSnapshot(filePath, sourceUrl, html) {
  const savedFrom = `<!-- saved from url=(0021)${sourceUrl} -->\n`;
  fs.writeFileSync(filePath, `${savedFrom}${html}\n`, 'utf8');
}

async function extractSectionLinks(page, rootUrl) {
  const root = new URL(rootUrl);
  const links = await page.evaluate(rootHref => {
    const rootUrlObj = new URL(rootHref);
    const anchors = [...document.querySelectorAll('a[href]')];
    return anchors
      .map(anchor => {
        const href = anchor.getAttribute('href') || '';
        const text = anchor.textContent.trim();
        try {
          const absolute = new URL(href, rootHref).toString();
          return { href: absolute, text };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(link => {
        const url = new URL(link.href);
        if (url.origin !== rootUrlObj.origin) return false;
        if (!url.pathname.startsWith(rootUrlObj.pathname)) return false;
        if (url.pathname === rootUrlObj.pathname) return false;
        if (url.search || url.hash) return false;
        return true;
      });
  }, root.toString());

  const unique = new Map();
  for (const link of links) {
    const key = link.href.replace(/\/$/, '');
    if (!unique.has(key)) unique.set(key, link);
  }

  return [...unique.values()].sort((a, b) => a.href.localeCompare(b.href));
}

async function savePage(page, entry, filePath) {
  await page.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const title = await page.title();
  const html = await page.content();
  saveHtmlSnapshot(filePath, entry.href, html);
  return { title, htmlLength: html.length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = resolveOutputDir(options.url, options.outDir);
  ensureDir(outputDir);
  const userDataDir = options.userDataDir
    ? path.resolve(PROJECT_ROOT, options.userDataDir)
    : path.join(outputDir, '.browser-profile');

  const manifest = {
    sourceCatalogUrl: options.url,
    generatedAt: new Date().toISOString(),
    outputDir: path.relative(PROJECT_ROOT, outputDir).replace(/\\/g, '/'),
    pages: [],
  };

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.headless,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();

  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  if (options.waitMs > 0) {
    console.log(`Waiting ${options.waitMs}ms for manual page verification...`);
    await page.waitForTimeout(options.waitMs);
  }

  const rootHtml = await page.content();
  saveHtmlSnapshot(path.join(outputDir, '000-root.html'), options.url, rootHtml);

  let sectionLinks = await extractSectionLinks(page, options.url);
  if (options.limit > 0) {
    sectionLinks = sectionLinks.slice(0, options.limit);
  }

  for (let index = 0; index < sectionLinks.length; index += 1) {
    const entry = sectionLinks[index];
    const filename = `${pad(index + 1)}-${sanitizeFileName(entry.text || path.basename(new URL(entry.href).pathname))}.html`;
    const filePath = path.join(outputDir, filename);
    const details = await savePage(page, entry, filePath);
    manifest.pages.push({
      index: index + 1,
      title: details.title,
      label: entry.text,
      url: entry.href,
      file: path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/'),
      htmlLength: details.htmlLength,
    });
    console.log(`[${index + 1}/${sectionLinks.length}] saved ${filename}`);
    await page.waitForTimeout(1200);
  }

  await context.close();

  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Catalog root saved to ${path.relative(PROJECT_ROOT, outputDir).replace(/\\/g, '/')}`);
  console.log(`Section pages saved: ${manifest.pages.length}`);
  console.log(`Manifest written: ${path.relative(PROJECT_ROOT, manifestPath).replace(/\\/g, '/')}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CATALOG_FILE = path.join(PROJECT_ROOT, 'data', 'catalog-data.json');
const PARTS_MAP_FILE = path.join(PROJECT_ROOT, 'data', 'diagram-parts.json');
const OUTPUT_JSON = path.join(PROJECT_ROOT, 'data', 'catalog-audit.json');
const OUTPUT_MD = path.join(PROJECT_ROOT, 'data', 'catalog-audit.md');

function load(fp) {
  let raw = fs.readFileSync(fp, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

function isHardware(description = '') {
  return /(screw|bolt|nut|washer|clip|pin|grommet|bracket|rivet|fastener)/i.test(description);
}

function normaliseTextKey(text = '') {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const catalog = load(CATALOG_FILE);
const partsMapData = fs.existsSync(PARTS_MAP_FILE) ? load(PARTS_MAP_FILE) : {};
const partByNumber = new Map((catalog.parts || []).map(p => [p.partNumber, p]));

const duplicateTitles = new Map();
for (const diagram of catalog.diagrams || []) {
  duplicateTitles.set(diagram.title, (duplicateTitles.get(diagram.title) || 0) + 1);
}

const diagramsNeedingReview = [];
for (const diagram of catalog.diagrams || []) {
  const hotspotRefs = [...new Set((diagram.hotspots || []).map(h => h.callout))];
  const partNumbers = [...new Set((diagram.hotspots || []).map(h => h.partNumber))];
  const parts = partNumbers.map(pn => partByNumber.get(pn)).filter(Boolean);
  const nonHardware = parts.filter(p => !isHardware(p.description));
  const scraped = partsMapData[diagram.id] || {};
  const scrapedRefs = [...new Set((scraped.items || []).map(item => item.refNumber))];

  if (
    hotspotRefs.length === 0 ||
    scrapedRefs.length !== hotspotRefs.length ||
    duplicateTitles.get(diagram.title) > 1 ||
    (partNumbers.length <= 2 && nonHardware.length <= 1)
  ) {
    diagramsNeedingReview.push({
      id: diagram.id,
      title: diagram.title,
      subtitle: diagram.subtitle || '',
      hotspotRefs: hotspotRefs.length,
      scrapedRefs: scrapedRefs.length,
      partNumbers,
      primaryParts: nonHardware.map(p => `${p.partNumber} ${p.description}`),
      duplicateTitleCount: duplicateTitles.get(diagram.title) || 0,
    });
  }
}

const partsMissingLinks = (catalog.parts || [])
  .filter(part => !part.links || part.links.length === 0)
  .map(part => ({ partNumber: part.partNumber, description: part.description }));

const groupedByDescription = new Map();
for (const part of catalog.parts || []) {
  const key = normaliseTextKey(part.description);
  if (!key) continue;
  if (!groupedByDescription.has(key)) groupedByDescription.set(key, []);
  groupedByDescription.get(key).push(part.partNumber);
}
const mergeCandidates = [...groupedByDescription.entries()]
  .filter(([, nums]) => nums.length > 1)
  .map(([descriptionKey, nums]) => ({ descriptionKey, partNumbers: nums }))
  .slice(0, 200);

const report = {
  summary: {
    partCount: (catalog.parts || []).length,
    diagramCount: (catalog.diagrams || []).length,
    partsMissingLinks: partsMissingLinks.length,
    duplicateDiagramTitles: [...duplicateTitles.entries()].filter(([, count]) => count > 1),
    diagramsNeedingReview: diagramsNeedingReview.length,
  },
  diagramsNeedingReview,
  partsMissingLinks,
  mergeCandidates,
};

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2), 'utf8');

const md = [
  '# Catalog Audit',
  '',
  `- Parts: ${report.summary.partCount}`,
  `- Diagrams: ${report.summary.diagramCount}`,
  `- Parts missing links: ${report.summary.partsMissingLinks}`,
  `- Diagrams needing review: ${report.summary.diagramsNeedingReview}`,
  '',
  '## Duplicate Diagram Titles',
  ...report.summary.duplicateDiagramTitles.map(([title, count]) => `- ${title}: ${count}`),
  '',
  '## Diagrams Needing Review',
  ...diagramsNeedingReview.map(item =>
    `- ${item.id} | ${item.title} | refs ${item.hotspotRefs}/${item.scrapedRefs} | primary: ${item.primaryParts.join('; ')}`
  ),
  '',
  '## Parts Missing Links',
  ...partsMissingLinks.map(item => `- ${item.partNumber} | ${item.description}`),
].join('\n');

fs.writeFileSync(OUTPUT_MD, md, 'utf8');

console.log(`Audit written to ${OUTPUT_JSON}`);
console.log(`Audit written to ${OUTPUT_MD}`);

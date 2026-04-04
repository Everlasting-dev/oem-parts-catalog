'use strict';
/**
 * build-variants-sheet.js
 *
 * Adds a "Part Variants Index" sheet to the working Excel file.
 * The sheet lists every variant group (parts sharing a PNC function / same description)
 * organised by system, with one row per part number, sorted by production period.
 *
 * Usage:
 *   node scripts/build-variants-sheet.js
 */

const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const PROJECT_ROOT  = path.resolve(__dirname, '..');
const CATALOG_FILE  = path.join(PROJECT_ROOT, 'data', 'catalog-data.json');
const EXCEL_FILE    = path.join(PROJECT_ROOT, 'R35 Master Parts Catalog.xlsx');

// ── helpers ────────────────────────────────────────────────────────────────

function loadJson(fp) {
  let raw = fs.readFileSync(fp, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

function parseYearMonth(periodText) {
  // "MM.YYYY - MM.YYYY"  → sort key "YYYY-MM"
  const m = String(periodText || '').match(/(\d{2})\.(\d{4})/);
  return m ? `${m[2]}-${m[1]}` : '9999-99';
}

function cleanApplies(text) {
  return String(text || '').replace(/^Applies:\s*/i, '').trim();
}

function amayamaUrl(pn) {
  return `https://www.amayama.com/en/part/nissan/${pn.replace(/[-\s]/g, '').toLowerCase()}`;
}

function npdUrl(pn) {
  return `https://www.nissanpartsdeal.com/parts/${pn}.html`;
}

// ── load catalog ───────────────────────────────────────────────────────────

const cat = loadJson(CATALOG_FILE);

// Build quick lookups
const partsByNumber = new Map(cat.parts.map(p => [p.partNumber, p]));

// partNumber → system title (first diagram that contains it as a hotspot)
const partSystem   = new Map();
const partFunction = new Map(); // partNumber → pnc description from diagrams

for (const diag of cat.diagrams) {
  const sys = diag.viewFamilyTitle || diag.title || 'Unassigned';
  for (const h of diag.hotspots || []) {
    if (h.partNumber && !partSystem.has(h.partNumber)) {
      partSystem.set(h.partNumber, sys);
    }
  }
}

// ── build variant groups ───────────────────────────────────────────────────

const seen   = new Set();
const groups = []; // { system, funcDesc, members[] }

for (const part of cat.parts) {
  const related = part.relatedPartNumbers || [];
  const allPNs  = [part.partNumber, ...related].sort();
  const key     = allPNs.join('|');
  if (seen.has(key)) continue;
  seen.add(key);

  const members = allPNs
    .map(pn => partsByNumber.get(pn))
    .filter(Boolean)
    .sort((a, b) => parseYearMonth(a.period).localeCompare(parseYearMonth(b.period)));

  const sys = partSystem.get(part.partNumber) || 'Unassigned';
  const funcDesc = part.description || '';

  groups.push({ system: sys, funcDesc, members });
}

// Sort groups: system asc → funcDesc asc
groups.sort((a, b) =>
  a.system.localeCompare(b.system) ||
  a.funcDesc.localeCompare(b.funcDesc)
);

// ── build sheet rows ───────────────────────────────────────────────────────

/*
 * Sheet layout
 * ─────────────────────────────────────────────────────────────────
 * Row 1   Title banner
 * Row 2   Sub-title / instructions
 * Row 3   (blank)
 * Row 4   Column headers
 * …       Data (group header + variant rows + blank separator)
 * ─────────────────────────────────────────────────────────────────
 *
 * Columns (A–K):
 *  A  System
 *  B  Part Function / Description
 *  C  Variant Count
 *  D  Period
 *  E  OEM Part Number
 *  F  Full Description
 *  G  Applies To
 *  H  Notes
 *  I  Qty
 *  J  Price (AED)
 *  K  Amayama URL
 *  L  Nissan Parts Deal URL
 */

const COL_HEADERS = [
  'System',
  'Part Function',
  '# Variants',
  'Period',
  'OEM Part Number',
  'Full Description',
  'Applies To',
  'Notes',
  'Qty',
  'Price (AED)',
  'Amayama URL',
  'Nissan Parts Deal URL',
];

const aoa = []; // array-of-arrays for the sheet

// Banner
aoa.push(['Part Variants Index — Nissan GT-R R35  |  All known multi-variant parts grouped by system and function']);
aoa.push(['One row per part number. Each block = one part function (PNC code). Parts are sorted chronologically by production period within each block.']);
aoa.push([]); // blank
aoa.push(COL_HEADERS);

let systemCount = 0;
let lastSystem  = '';
let variantTotal = 0;

for (const g of groups) {
  if (g.system !== lastSystem) {
    // System separator
    aoa.push([]); // blank row between systems
    aoa.push([`── ${g.system.toUpperCase()} ──`]);
    lastSystem = g.system;
    systemCount++;
  }

  const memberCount = g.members.length;
  variantTotal += memberCount;

  for (let i = 0; i < memberCount; i++) {
    const m = g.members[i];
    const links = m.links || [];
    const amLink = links.find(l => l.sourceName && l.sourceName.includes('amayama'))?.url || amayamaUrl(m.partNumber);
    const npdLink = links.find(l => l.sourceName && l.sourceName.includes('nissanpartsdeal'))?.url || npdUrl(m.partNumber);

    aoa.push([
      i === 0 ? g.system     : '',              // A – System (only first row of group)
      i === 0 ? g.funcDesc   : '',              // B – Part Function (only first row)
      i === 0 ? memberCount  : '',              // C – # Variants (only first row)
      m.period        || '',                    // D – Period
      m.partNumber    || '',                    // E – OEM Part Number
      m.description   || '',                    // F – Full Description
      cleanApplies(m.appliesDetails),           // G – Applies To
      m.notes         || '',                    // H – Notes
      m.requiredQty   || '',                    // I – Qty
      m.priceAed      || '',                    // J – Price AED
      amLink,                                   // K – Amayama URL
      npdLink,                                  // L – NPD URL
    ]);
  }

  aoa.push([]); // blank row between groups
}

console.log(`Systems: ${systemCount}  |  Variant groups: ${groups.length}  |  Total part rows: ${variantTotal}`);

// ── write to Excel ─────────────────────────────────────────────────────────

const wb = XLSX.readFile(EXCEL_FILE);

// Remove old sheet if it exists
const SHEET_NAME = 'Part Variants Index';
if (wb.SheetNames.includes(SHEET_NAME)) {
  const idx = wb.SheetNames.indexOf(SHEET_NAME);
  wb.SheetNames.splice(idx, 1);
  delete wb.Sheets[SHEET_NAME];
}

const ws = XLSX.utils.aoa_to_sheet(aoa);

// Column widths
ws['!cols'] = [
  { wch: 34 },  // A System
  { wch: 40 },  // B Part Function
  { wch: 10 },  // C # Variants
  { wch: 22 },  // D Period
  { wch: 18 },  // E OEM Part Number
  { wch: 44 },  // F Full Description
  { wch: 38 },  // G Applies To
  { wch: 38 },  // H Notes
  { wch: 6  },  // I Qty
  { wch: 12 },  // J Price AED
  { wch: 55 },  // K Amayama URL
  { wch: 55 },  // L NPD URL
];

// Freeze top 4 rows (banner + headers) and first 2 columns
ws['!freeze'] = { xSplit: 2, ySplit: 4 };

// Auto-filter on header row (row 4 = index 3)
const lastCol = XLSX.utils.encode_col(COL_HEADERS.length - 1);
const lastRow = aoa.length;
ws['!autofilter'] = { ref: `A4:${lastCol}${lastRow}` };

XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

// Move new sheet to be right after existing sheets (second position from end)
const pos = wb.SheetNames.indexOf(SHEET_NAME);
wb.SheetNames.splice(pos, 1);
wb.SheetNames.push(SHEET_NAME); // place at end

XLSX.writeFile(wb, EXCEL_FILE);
console.log(`Written: ${EXCEL_FILE}`);

// Also write to Downloads folder
const DOWNLOADS_FILE = path.join('C:\\Users\\akram\\Downloads', path.basename(EXCEL_FILE));
if (fs.existsSync(DOWNLOADS_FILE)) {
  XLSX.writeFile(wb, DOWNLOADS_FILE);
  console.log(`Written: ${DOWNLOADS_FILE}`);
}

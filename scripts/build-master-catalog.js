"use strict";
/**
 * build-master-catalog.js
 *
 * Creates a brand-new standalone Excel workbook: "R35 Master Parts Catalog.xlsx"
 *
 * For every system/diagram section:
 *   - Embeds the diagram image on the left (columns A–H)
 *   - Lists ALL parts that belong to that diagram on the right
 *   - Expands every part's period variants (relatedPartNumbers) so all
 *     manufacturing dates and models are visible in one place
 *
 * Usage:  node scripts/build-master-catalog.js
 */

const path = require("path");
const fs   = require("fs");
const ExcelJS = require("exceljs");

const ROOT       = path.join(__dirname, "..");
const JSON_PATH  = path.join(ROOT, "data", "catalog-data.json");
const ASSETS_DIR = path.join(ROOT, "assets", "diagrams");
const OUTPUT     = path.join(ROOT, "R35 Master Parts Catalog.xlsx");

const MERGE_ALIASES = new Map([
  ["alternator fitting", "alternator"],
  ["anti skid control chassis", "anti skid control"],
  ["wiring denso", "wiring"],
  ["manifold engine", "manifold"],
  ["floor panel rear", "floor panel"],
]);

function canonKey(title) {
  const n = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return MERGE_ALIASES.get(n) || n;
}

const CLR = {
  sectionBg:  "FF1F3864",
  sectionFg:  "FFFFFFFF",
  specBg:     "FFD6E4F7",
  specFg:     "FF1F3864",
  colHdrBg:   "FF2E75B6",
  colHdrFg:   "FFFFFFFF",
  rowEven:    "FFF2F7FF",
  rowOdd:     null,
  imageBg:    "FFF0F4FA",
  linkClr:    "FF0563C1",
  borderClr:  "FFB4C6D8",
};

const COL_HEADERS = ["OEM", "Description", "Applies / Details", "Period", "Notes", "Match"];
const COL_WIDTHS  = [20, 38, 26, 22, 34, 24];
const IMG_COLS    = 8;
const DATA_COL0   = IMG_COLS + 1; // column I = 9

function resolveImage(diag) {
  if (!diag.imagePath) return null;
  const full = path.join(ROOT, diag.imagePath);
  return fs.existsSync(full) ? full : null;
}

function descriptionKey(text) {
  return (text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchKeywords(part) {
  const tokens = new Set();
  const desc = descriptionKey(part.description);
  const notes = descriptionKey(part.notes);
  const all = `${desc} ${notes}`;

  const keywords = [
    "engine", "mount", "gasket", "seal", "bolt", "nut", "washer", "plug",
    "hose", "pipe", "tube", "bracket", "insulator", "sensor", "relay",
    "harness", "connector", "module", "actuator", "pump", "motor",
    "valve", "spring", "bearing", "bushing", "damper", "cover",
    "switch", "lamp", "mirror", "belt", "chain", "gear", "shaft",
    "rotor", "caliper", "pad", "disc", "cylinder", "piston",
    "alternator", "starter", "coil", "ignition", "wiring", "fuse",
    "radiator", "fan", "cooler", "thermostat", "compressor",
    "bumper", "fender", "panel", "door", "window", "trim",
    "seat", "console", "spoiler", "emblem", "key",
  ];
  for (const kw of keywords) {
    if (all.includes(kw)) tokens.add(kw);
  }
  return [...tokens].sort().join(", ");
}

async function main() {
  console.log("Loading catalog-data.json ...");
  const raw = fs.readFileSync(JSON_PATH, "utf8").replace(/^\uFEFF/, "");
  const catalog = JSON.parse(raw);

  const partMap = new Map();
  for (const p of catalog.parts || []) partMap.set(p.partNumber, p);
  console.log(`  ${partMap.size} parts in database`);

  // ── Build merged sections ─────────────────────────────────────────────
  const sectionMap = new Map();
  const sections = [];

  for (const diag of catalog.diagrams || []) {
    const key = canonKey(diag.title || "untitled");
    if (!sectionMap.has(key)) {
      const sec = {
        id: diag.id,
        title: diag.title,
        diagrams: [],
        imagePath: resolveImage(diag),
        partNumberSet: new Set(),
      };
      sectionMap.set(key, sec);
      sections.push(sec);
    }
    const sec = sectionMap.get(key);
    sec.diagrams.push(diag);
    if (!sec.imagePath) sec.imagePath = resolveImage(diag);
    for (const h of diag.hotspots || []) {
      if (h.partNumber) sec.partNumberSet.add(h.partNumber);
    }
  }

  console.log(`  ${sections.length} sections`);

  // ── Expand variants per section ───────────────────────────────────────
  // For each hotspot part, also pull in every relatedPartNumber that shares
  // the same description key — so all period variants are shown.
  function expandedRows(section) {
    const seen = new Set();
    const rows = [];

    for (const pn of section.partNumberSet) {
      const part = partMap.get(pn);
      if (!part || seen.has(pn)) continue;
      seen.add(pn);

      rows.push(part);

      for (const relPn of part.relatedPartNumbers || []) {
        if (seen.has(relPn)) continue;
        const relPart = partMap.get(relPn);
        if (!relPart) continue;
        if (descriptionKey(relPart.description) === descriptionKey(part.description)) {
          seen.add(relPn);
          rows.push(relPart);
        }
      }
    }

    rows.sort((a, b) => {
      const d = descriptionKey(a.description).localeCompare(descriptionKey(b.description));
      if (d !== 0) return d;
      return (a.period || "").localeCompare(b.period || "");
    });

    return rows;
  }

  // ── Create workbook ───────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "R35 Catalog Builder";
  wb.created = new Date();

  const ws = wb.addWorksheet("Master Catalog", {
    properties: { tabColor: { argb: "FF1F3864" } },
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // Column widths
  for (let c = 1; c <= IMG_COLS; c++) ws.getColumn(c).width = 3.5;
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(DATA_COL0 + i).width = w; });

  // ── Title rows ────────────────────────────────────────────────────────
  const t1 = ws.getCell("A1");
  t1.value = "Nissan GT-R R35  —  Master Parts Catalog";
  t1.font = { bold: true, size: 16, color: { argb: CLR.sectionFg } };
  t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.sectionBg } };
  ws.mergeCells(1, 1, 1, DATA_COL0 + COL_HEADERS.length - 1);
  ws.getRow(1).height = 28;

  const t2 = ws.getCell("A2");
  t2.value = "All systems  •  All manufacturing dates  •  All models  •  Period variants expanded";
  t2.font = { italic: true, size: 11, color: { argb: CLR.specFg } };
  t2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.specBg } };
  ws.mergeCells(2, 1, 2, DATA_COL0 + COL_HEADERS.length - 1);
  ws.getRow(2).height = 20;

  let curRow = 4;

  // ── Write sections ────────────────────────────────────────────────────
  for (const section of sections) {
    const rows = expandedRows(section);
    const numRows = rows.length;

    // Section heading number
    const numMatch = section.id.match(/^diagram-(\d+)$/);
    const label = numMatch
      ? `${numMatch[1].padStart(3, "0")} - ${section.title}`
      : section.title;

    // ── Section header row ──────────────────────────────────────────────
    const hdrRow = curRow;
    ws.getRow(hdrRow).height = 22;
    const hdrCell = ws.getCell(hdrRow, 1);
    hdrCell.value = `${label}  |  ${numRows} matched part(s)`;
    hdrCell.font = { bold: true, size: 13, color: { argb: CLR.sectionFg } };
    hdrCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.sectionBg } };
    ws.mergeCells(hdrRow, 1, hdrRow, DATA_COL0 + COL_HEADERS.length - 1);
    for (let c = 1; c <= DATA_COL0 + COL_HEADERS.length - 1; c++) {
      ws.getCell(hdrRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.sectionBg } };
    }
    curRow++;

    // ── Spec / model row ────────────────────────────────────────────────
    const periods = [...new Set(rows.map(p => p.period).filter(Boolean))];
    const applies = [...new Set(rows.map(p => p.appliesDetails).filter(Boolean))];
    const specParts = [];
    if (applies.length) specParts.push(`App. model: ${applies.slice(0, 3).join(", ")}`);
    if (periods.length) specParts.push(`[${periods[0]}${periods.length > 1 ? " ... " + periods[periods.length - 1] : ""}]`);
    const specText = specParts.join(" • ") || "App. model: VR38DETT";

    const specRow = curRow;
    ws.getRow(specRow).height = 16;
    const specCell = ws.getCell(specRow, 1);
    specCell.value = specText;
    specCell.font = { italic: true, size: 10, color: { argb: CLR.specFg } };
    specCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.specBg } };
    ws.mergeCells(specRow, 1, specRow, DATA_COL0 + COL_HEADERS.length - 1);
    for (let c = 1; c <= DATA_COL0 + COL_HEADERS.length - 1; c++) {
      ws.getCell(specRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.specBg } };
    }
    curRow++;

    // ── Column headers ──────────────────────────────────────────────────
    const colHdrRow = curRow;
    ws.getRow(colHdrRow).height = 18;
    // Fill image area background
    for (let c = 1; c <= IMG_COLS; c++) {
      ws.getCell(colHdrRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.imageBg } };
    }
    COL_HEADERS.forEach((h, i) => {
      const cell = ws.getCell(colHdrRow, DATA_COL0 + i);
      cell.value = h;
      cell.font = { bold: true, size: 11, color: { argb: CLR.colHdrFg } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.colHdrBg } };
      cell.alignment = { vertical: "middle" };
      cell.border = {
        bottom: { style: "thin", color: { argb: CLR.borderClr } },
      };
    });
    curRow++;

    // ── Data rows ───────────────────────────────────────────────────────
    const dataStartRow = curRow;
    if (numRows === 0) {
      const cell = ws.getCell(curRow, DATA_COL0);
      cell.value = "(no hotspot data for this diagram)";
      cell.font = { italic: true, color: { argb: "FF999999" } };
      ws.mergeCells(curRow, DATA_COL0, curRow, DATA_COL0 + COL_HEADERS.length - 1);
      // Fill image bg
      for (let c = 1; c <= IMG_COLS; c++) {
        ws.getCell(curRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.imageBg } };
      }
      curRow++;
    } else {
      rows.forEach((p, idx) => {
        const r = curRow;
        const isEven = idx % 2 === 0;
        const fillColor = isEven ? CLR.rowEven : CLR.rowOdd;

        const values = [
          p.partNumber || "",
          p.description || "",
          p.appliesDetails || "",
          p.period || "",
          p.notes || "",
          matchKeywords(p),
        ];

        // Image area background
        for (let c = 1; c <= IMG_COLS; c++) {
          const cell = ws.getCell(r, c);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.imageBg } };
        }

        values.forEach((v, i) => {
          const cell = ws.getCell(r, DATA_COL0 + i);
          cell.value = v;
          cell.font = { size: 10 };
          cell.alignment = { vertical: "middle", wrapText: i === 1 || i === 4 };
          cell.border = {
            bottom: { style: "hair", color: { argb: "FFE0E0E0" } },
          };
          if (fillColor) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
          }
        });
        ws.getRow(r).height = 16;
        curRow++;
      });
    }
    const dataEndRow = curRow - 1;

    // ── Embed image ─────────────────────────────────────────────────────
    if (section.imagePath) {
      const ext = path.extname(section.imagePath).slice(1).toLowerCase();
      try {
        const imgId = wb.addImage({
          filename: section.imagePath,
          extension: ext === "gif" ? "gif" : "png",
        });
        const imgTopRow = colHdrRow; // image starts at column-header row
        const imgBotRow = Math.max(dataEndRow, imgTopRow + 3);
        ws.addImage(imgId, {
          tl: { col: 0, row: imgTopRow - 1 },
          br: { col: IMG_COLS, row: imgBotRow },
          editAs: "oneCell",
        });
      } catch (e) {
        console.warn(`  [WARN] Image failed for "${section.title}": ${e.message}`);
      }
    }

    // Separator row
    ws.getRow(curRow).height = 6;
    curRow++;

    // Progress
    const pctDone = ((sections.indexOf(section) + 1) / sections.length * 100).toFixed(0);
    process.stdout.write(`\r  [${pctDone}%] ${label} (${numRows} parts)`);
  }

  console.log("\n\nSaving workbook ...");
  await wb.xlsx.writeFile(OUTPUT);

  const totalExpanded = sections.reduce((s, sec) => s + expandedRows(sec).length, 0);
  console.log(`Done! Saved to: ${OUTPUT}`);
  console.log(`\nSummary:`);
  console.log(`  Sections           : ${sections.length}`);
  console.log(`  Total expanded rows: ${totalExpanded}`);
  console.log(`  Parts in database  : ${partMap.size}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

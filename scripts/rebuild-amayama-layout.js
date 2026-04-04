"use strict";
/**
 * rebuild-amayama-layout.js
 *
 * Rebuilds the "Amayama Layout" sheet in the Excel workbook using
 * catalog-data.json as the authoritative source for which parts belong
 * to which diagram. Each section embeds the local diagram image and
 * lists ONLY parts confirmed by hotspot data — no keyword guessing.
 *
 * Usage:  node scripts/rebuild-amayama-layout.js
 */

const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");

const ROOT = path.join(__dirname, "..");
const JSON_PATH = path.join(ROOT, "data", "catalog-data.json");
const EXCEL_PATH = path.join(ROOT, "R35 Master Parts Catalog.xlsx");
const ASSETS_DIR = path.join(ROOT, "assets", "diagrams");

// ── Colour palette ──────────────────────────────────────────────────────────
const CLR = {
  headerBg:    "FF2E75B6",   // section-header fill (blue)
  headerFg:    "FFFFFFFF",   // header text (white)
  headingBg:   "FFDAE3F3",   // section-title row fill (light blue)
  headingFg:   "FF1F3864",   // section-title text (dark navy)
  colHdrBg:    "FF1F3864",   // column-header fill (navy)
  colHdrFg:    "FFFFFFFF",
  rowEven:     "FFF2F7FF",   // even data-row tint
  link:        "FF0563C1",
  unassHdr:    "FFC00000",   // unassigned heading text
  unassHdrBg:  "FFFFF0F0",
  unassColBg:  "FFCC3333",
  unassEven:   "FFFFF8F8",
  imageBg:     "FFF0F4FA",   // background behind the image block
  specFg:      "FF595959",
};

// Number of "image-area" columns (A–H, cols 1–8)
const IMG_COLS = 8;

async function main() {
  // ── Load catalog data ──────────────────────────────────────────────────
  console.log("Loading catalog-data.json …");
  const raw = fs.readFileSync(JSON_PATH, "utf8").replace(/^\uFEFF/, "");
  const catalog = JSON.parse(raw);

  const partMap = new Map();
  (catalog.parts || []).forEach(p => partMap.set(p.partNumber, p));
  console.log(`  ${partMap.size} parts in database`);

  // ── Merge aliases — same map used in app.js ─────────────────────────────
  const MERGE_ALIASES = new Map([
    ["alternator fitting", "alternator"],
    ["anti skid control chassis", "anti skid control"],
    ["wiring denso", "wiring"],
    ["manifold engine", "manifold"],
    ["floor panel rear", "floor panel"],
  ]);

  function canonicalTitle(rawTitle) {
    const norm = rawTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return MERGE_ALIASES.get(norm) || norm;
  }

  // ── Build section list ─────────────────────────────────────────────────
  // Numbered diagrams → one section each (but merge aliases combine them)
  // Amayama sub-diagrams → grouped by canonical title
  const sectionMap = new Map(); // canonicalKey → section object
  const sections = [];

  function getOrCreateSection(key, rawTitle, diag, isAmayama) {
    if (!sectionMap.has(key)) {
      const section = {
        id: diag.id,
        title: rawTitle,
        imagePath: resolveImage(diag, ROOT),
        partNumbers: [],
        partNumberSet: new Set(),
        isAmayama,
      };
      sectionMap.set(key, section);
      sections.push(section);
    }
    return sectionMap.get(key);
  }

  for (const diag of (catalog.diagrams || [])) {
    const isAmayama = diag.id.startsWith("amayama-");
    const rawTitle = diag.title || "Untitled";
    const key = canonicalTitle(rawTitle);

    const section = getOrCreateSection(key, rawTitle, diag, isAmayama || sectionMap.get(key)?.isAmayama);

    if (!section.imagePath) {
      section.imagePath = resolveImage(diag, ROOT);
    }

    (diag.hotspots || []).forEach(h => {
      if (h.partNumber && !section.partNumberSet.has(h.partNumber)) {
        section.partNumberSet.add(h.partNumber);
        section.partNumbers.push(h.partNumber);
      }
    });
  }

  console.log(`  ${sections.length} sections to write`);

  // ── Open workbook ──────────────────────────────────────────────────────
  console.log("Opening workbook …");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);

  // Remove old sheet
  const old = workbook.getWorksheet("Amayama Layout");
  if (old) {
    workbook.removeWorksheet(old.id);
    console.log("  Removed old Amayama Layout sheet");
  }

  // Add new sheet
  const ws = workbook.addWorksheet("Amayama Layout", {
    properties: { tabColor: { argb: "FF2E75B6" } },
    views: [],
  });

  // ── Column widths ──────────────────────────────────────────────────────
  // A–H: narrow image-area columns
  for (let c = 1; c <= IMG_COLS; c++) ws.getColumn(c).width = 3.8;
  // Data columns
  ws.getColumn(9).width  = 20;  // OEM Part Number
  ws.getColumn(10).width = 42;  // Description
  ws.getColumn(11).width = 22;  // Applies / Details
  ws.getColumn(12).width = 24;  // Period
  ws.getColumn(13).width = 32;  // Notes
  ws.getColumn(14).width = 6;   // Qty
  ws.getColumn(15).width = 13;  // Price (AED)
  ws.getColumn(16).width = 55;  // Amayama URL

  // ── Sheet header rows ──────────────────────────────────────────────────
  const r1 = ws.getRow(1);
  r1.height = 22;
  const c1 = ws.getCell("I1");
  c1.value = "Amayama-style Layout  |  Parts verified against diagram hotspot data";
  c1.font = { bold: true, size: 12, color: { argb: CLR.headingFg } };
  c1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4F7" } };
  ws.mergeCells("I1:P1");

  const c2 = ws.getCell("I2");
  c2.value = "Each section lists only parts confirmed by hotspot data — no keyword guessing.";
  c2.font = { italic: true, size: 10, color: { argb: CLR.specFg } };
  c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF4FC" } };
  ws.mergeCells("I2:P2");

  let currentRow = 4; // start writing sections from row 4
  const usedPartNumbers = new Set();

  // ── Write each section ─────────────────────────────────────────────────
  for (const section of sections) {
    const parts = section.partNumbers
      .map(pn => partMap.get(pn))
      .filter(Boolean);

    parts.forEach(p => usedPartNumbers.add(p.partNumber));

    const numParts = parts.length;
    // Rows needed: heading(1) + spec(1) + col-headers(1) + data rows + 1 blank gap
    const dataRows = Math.max(numParts, 1);
    const sectionHeight = 3 + dataRows; // heading+spec+colHdr + data
    const imageEndRow = currentRow + sectionHeight - 1;

    // Label for heading
    const diagramNumMatch = section.id.match(/^diagram-(\d+)$/);
    const headingLabel = diagramNumMatch
      ? `${diagramNumMatch[1].padStart(3, "0")} – ${section.title}`
      : section.title;

    // ── Heading row ──────────────────────────────────────────────────────
    styleHeadingRow(ws, currentRow, headingLabel, numParts);

    // ── Spec / period row ────────────────────────────────────────────────
    const specRow = currentRow + 1;
    const uniquePeriods = [...new Set(parts.map(p => p.period).filter(Boolean))];
    const uniqueApplies = [...new Set(parts.map(p => p.appliesDetails).filter(Boolean))];
    const specText = uniquePeriods.length > 0
      ? `Period: ${uniquePeriods.slice(0, 4).join("  •  ")}`
      : uniqueApplies.length > 0
        ? `Applies: ${uniqueApplies[0]}`
        : "Applies: VR38DETT";

    const specCell = ws.getCell(specRow, 9);
    specCell.value = specText;
    specCell.font = { italic: true, size: 10, color: { argb: CLR.specFg } };
    specCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F9FF" } };
    ws.mergeCells(specRow, 9, specRow, 16);

    // ── Column header row ────────────────────────────────────────────────
    const colHdrRow = currentRow + 2;
    writeColumnHeaders(ws, colHdrRow);

    // ── Data rows ────────────────────────────────────────────────────────
    if (numParts === 0) {
      const noDataCell = ws.getCell(colHdrRow + 1, 9);
      noDataCell.value = "No hotspot data available for this diagram";
      noDataCell.font = { italic: true, color: { argb: "FF999999" } };
      ws.mergeCells(colHdrRow + 1, 9, colHdrRow + 1, 16);
    } else {
      parts.forEach((p, idx) => {
        writePartRow(ws, colHdrRow + 1 + idx, p, idx);
      });
    }

    // ── Image background for A–H area ───────────────────────────────────
    for (let r = currentRow; r <= imageEndRow; r++) {
      for (let c = 1; c <= IMG_COLS; c++) {
        ws.getCell(r, c).fill = {
          type: "pattern", pattern: "solid", fgColor: { argb: CLR.imageBg },
        };
      }
    }

    // ── Embed image ──────────────────────────────────────────────────────
    if (section.imagePath && fs.existsSync(section.imagePath)) {
      const ext = path.extname(section.imagePath).slice(1).toLowerCase();
      const imgExt = ext === "gif" ? "gif" : "png";
      try {
        const imgId = workbook.addImage({
          filename: section.imagePath,
          extension: imgExt,
        });
        ws.addImage(imgId, {
          tl: { col: 0, row: currentRow - 1 },          // 0-indexed
          br: { col: IMG_COLS, row: imageEndRow },        // 0-indexed, exclusive
          editAs: "oneCell",
        });
      } catch (e) {
        console.warn(`  [WARN] Could not embed image for "${section.title}": ${e.message}`);
      }
    }

    // Blank separator row
    ws.getRow(imageEndRow + 1).height = 6;

    currentRow = imageEndRow + 2; // next section starts here

    process.stdout.write(`  ✓ ${headingLabel} (${numParts} parts)\n`);
  }

  // ── Unassigned parts section ───────────────────────────────────────────
  const unassigned = (catalog.parts || []).filter(
    p => !usedPartNumbers.has(p.partNumber)
  );

  if (unassigned.length > 0) {
    currentRow += 2; // extra gap before unassigned

    const uHead = ws.getCell(currentRow, 9);
    uHead.value = `UNASSIGNED PARTS  |  ${unassigned.length} part(s) not matched to any diagram`;
    uHead.font  = { bold: true, size: 12, color: { argb: CLR.unassHdr } };
    uHead.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.unassHdrBg } };
    ws.mergeCells(currentRow, 9, currentRow, 16);
    ws.getRow(currentRow).height = 20;
    currentRow++;

    const uSpec = ws.getCell(currentRow, 9);
    uSpec.value = "These parts exist in catalog-data.json but are not hotspotted to any diagram.";
    uSpec.font  = { italic: true, color: { argb: CLR.specFg } };
    ws.mergeCells(currentRow, 9, currentRow, 16);
    currentRow++;

    // Column headers (red variant)
    const HEADERS = ["OEM Part Number","Description","Applies / Details","Period","Notes","Qty","Price (AED)","Amayama URL"];
    HEADERS.forEach((h, i) => {
      const cell = ws.getCell(currentRow, 9 + i);
      cell.value = h;
      cell.font  = { bold: true, color: { argb: CLR.colHdrFg } };
      cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.unassColBg } };
    });
    currentRow++;

    unassigned.forEach((p, idx) => {
      writePartRow(ws, currentRow + idx, p, idx, true);
    });

    console.log(`  ✓ UNASSIGNED PARTS (${unassigned.length})`);
  }

  // ── Save workbook ──────────────────────────────────────────────────────
  console.log("\nSaving workbook … (this may take a moment with embedded images)");
  await workbook.xlsx.writeFile(EXCEL_PATH);
  console.log("Done! Saved to:", EXCEL_PATH);
  console.log("\nNOTE: Original file is unchanged. Review the rebuilt file then rename/replace as needed.");
  console.log(`\nSummary:`);
  console.log(`  Sections written : ${sections.length}`);
  console.log(`  Parts with diagrams : ${usedPartNumbers.size}`);
  console.log(`  Unassigned parts : ${unassigned.length}`);
}

// ── Helper: resolve image path ─────────────────────────────────────────────
function resolveImage(diag, root) {
  if (!diag.imagePath) return null;
  const full = path.join(root, diag.imagePath);
  return fs.existsSync(full) ? full : null;
}

// ── Helper: write heading row ──────────────────────────────────────────────
function styleHeadingRow(ws, rowNum, label, numParts) {
  ws.getRow(rowNum).height = 22;
  const cell = ws.getCell(rowNum, 9);
  cell.value = `${label}  |  ${numParts} part(s)`;
  cell.font  = { bold: true, size: 12, color: { argb: CLR.headingFg } };
  cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.headingBg } };
  cell.border = { bottom: { style: "thin", color: { argb: "FF2E75B6" } } };
  ws.mergeCells(rowNum, 9, rowNum, 16);
}

// ── Helper: write column headers ──────────────────────────────────────────
const HEADERS = [
  "OEM Part Number",
  "Description",
  "Applies / Details",
  "Period",
  "Notes",
  "Qty",
  "Price (AED)",
  "Amayama URL",
];

function writeColumnHeaders(ws, rowNum) {
  ws.getRow(rowNum).height = 16;
  HEADERS.forEach((h, i) => {
    const cell = ws.getCell(rowNum, 9 + i);
    cell.value = h;
    cell.font  = { bold: true, color: { argb: CLR.colHdrFg } };
    cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.colHdrBg } };
    cell.border = {
      top:    { style: "thin" },
      bottom: { style: "thin" },
    };
    cell.alignment = { vertical: "middle" };
  });
}

// ── Helper: write a part data row ──────────────────────────────────────────
function writePartRow(ws, rowNum, p, idx, unassigned = false) {
  const amayamaLink = (p.links || []).find(
    l => l.sourceName && l.sourceName.includes("amayama")
  );
  const linkUrl = amayamaLink
    ? amayamaLink.url
    : (p.supplierUrl || "");

  const values = [
    p.partNumber,
    p.description || "",
    p.appliesDetails || "",
    p.period || "",
    p.notes || "",
    p.requiredQty || "",
    p.priceAed || "",
    linkUrl,
  ];

  const rowFill = unassigned
    ? (idx % 2 === 0 ? CLR.unassEven : null)
    : (idx % 2 === 0 ? CLR.rowEven : null);

  values.forEach((v, i) => {
    const cell = ws.getCell(rowNum, 9 + i);
    if (i === 7 && v) {
      // Amayama URL: clickable hyperlink
      cell.value = { text: v, hyperlink: v };
      cell.font  = { color: { argb: CLR.link }, underline: true, size: 10 };
    } else {
      cell.value = v;
      cell.font  = { size: 10 };
    }
    if (rowFill) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
    }
    cell.alignment = { vertical: "middle", wrapText: i === 1 };
  });

  ws.getRow(rowNum).height = 15;
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

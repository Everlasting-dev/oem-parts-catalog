"use strict";
/**
 * add-gallery-sheet.js
 *
 * Opens "R35 Master Parts Catalog.xlsx" and writes:
 *   1. "Diagram Gallery" — every local sub-diagram image
 *   2. "Not in Master Catalog" — images that appear in the gallery but are NOT
 *      the single image embedded in the Master Catalog sheet for that system
 *      (same merge rules + same "first resolvable image" pick as build-master-catalog.js)
 *
 * Usage:  node scripts/add-gallery-sheet.js
 */

const path    = require("path");
const fs      = require("fs");
const ExcelJS = require("exceljs");

const ROOT      = path.join(__dirname, "..");
const JSON_PATH = path.join(ROOT, "data", "catalog-data.json");
const OUTPUT    = path.join(ROOT, "R35 Master Parts Catalog.xlsx");

const MERGE_ALIASES = new Map([
  ["alternator fitting",        "alternator"],
  ["anti skid control chassis", "anti skid control"],
  ["wiring denso",              "wiring"],
  ["manifold engine",           "manifold"],
  ["floor panel rear",          "floor panel"],
]);

function canonKey(title) {
  const n = (title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return MERGE_ALIASES.get(n) || n;
}
function canonTitle(title) {
  const key = canonKey(title);
  return key.split(" ").map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Same as build-master-catalog.js resolveImage */
function resolveImage(diag) {
  if (!diag.imagePath) return null;
  const full = path.join(ROOT, diag.imagePath);
  return fs.existsSync(full) ? full : null;
}

/**
 * Same section merge + master image pick as build-master-catalog.js
 */
function buildMergedSections(catalog) {
  const merged = new Map();
  for (const diag of catalog.diagrams || []) {
    const key = canonKey(diag.title || "untitled");
    if (!merged.has(key)) {
      merged.set(key, {
        displayTitle : canonTitle(diag.title || "untitled"),
        masterFullPath: resolveImage(diag),
        diagrams     : [],
      });
    }
    const sec = merged.get(key);
    sec.diagrams.push(diag);
    if (!sec.masterFullPath) sec.masterFullPath = resolveImage(diag);
  }
  return merged;
}

const CLR = {
  sectionBg : "FF1F3864",
  sectionFg : "FFFFFFFF",
  colHdrBg  : "FF2E75B6",
  colHdrFg  : "FFFFFFFF",
  rowBg     : "FFF2F7FF",
  imageBg   : "FFF0F4FA",
  accentTab : "FF8B5A2B",
};

const COLS_PER_ROW  = 3;
const IMG_COL_WIDTH = 38;
const IMG_ROW_HEIGHT = 110;
const SLOT_W = 2;

/**
 * Full gallery: every sub-diagram with a local file (same as before).
 */
function buildAllGallerySections(catalog) {
  const sectionMap = new Map();
  for (const diag of catalog.diagrams || []) {
    const key = canonKey(diag.title || "untitled");
    if (!sectionMap.has(key)) {
      sectionMap.set(key, {
        displayTitle : canonTitle(diag.title || "untitled"),
        subs         : [],
      });
    }
    const localFull = diag.imagePath ? path.join(ROOT, diag.imagePath) : null;
    const hasLocal  = localFull && fs.existsSync(localFull);
    if (hasLocal) {
      sectionMap.get(key).subs.push({
        subtitle : diag.subtitle || diag.title || diag.id,
        imgPath  : localFull,
        ext      : path.extname(localFull).slice(1).toLowerCase(),
        partCount: (diag.hotspots || []).filter(h => h.partNumber).length,
      });
    }
  }
  return [...sectionMap.values()].filter(s => s.subs.length > 0);
}

/**
 * Sub-diagrams whose image file is not the Master Catalog embedded image
 * for that merged system (path comparison after normalize).
 */
function buildNotInMasterSections(merged) {
  const out = [];
  for (const sec of merged.values()) {
    const masterNorm = sec.masterFullPath ? path.normalize(sec.masterFullPath) : null;
    const subs = [];
    for (const diag of sec.diagrams) {
      const full = resolveImage(diag);
      if (!full) continue;
      const norm = path.normalize(full);
      if (masterNorm && norm === masterNorm) continue;
      subs.push({
        subtitle : diag.subtitle || diag.title || diag.id,
        imgPath  : full,
        ext      : path.extname(full).slice(1).toLowerCase(),
        partCount: (diag.hotspots || []).filter(h => h.partNumber).length,
      });
    }
    if (subs.length > 0) out.push({ displayTitle: sec.displayTitle, subs });
  }
  return out;
}

function removeSheetByName(wb, name) {
  const old = wb.getWorksheet(name);
  if (old) wb.removeWorksheet(old.id);
}

/**
 * Renders one gallery-style sheet (section headers + 3-column image grid).
 */
function populateGallerySheet(ws, sections, mainTitle, subTitleText) {
  const TOTAL_COLS = COLS_PER_ROW * SLOT_W;
  for (let c = 1; c <= TOTAL_COLS; c++) ws.getColumn(c).width = IMG_COL_WIDTH / SLOT_W;

  ws.getRow(1).height = 28;
  const titleCell = ws.getCell(1, 1);
  titleCell.value = mainTitle;
  titleCell.font  = { bold: true, size: 16, color: { argb: CLR.sectionFg } };
  titleCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.sectionBg } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  ws.mergeCells(1, 1, 1, TOTAL_COLS);

  const subTitle = ws.getCell(2, 1);
  subTitle.value = subTitleText;
  subTitle.font  = { italic: true, size: 11, color: { argb: "FF1F3864" } };
  subTitle.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4F7" } };
  subTitle.alignment = { vertical: "middle", horizontal: "center" };
  ws.mergeCells(2, 1, 2, TOTAL_COLS);
  ws.getRow(2).height = 18;

  let curRow = 3;
  const totalImages = sections.reduce((n, s) => n + s.subs.length, 0);

  for (const section of sections) {
    ws.getRow(curRow).height = 22;
    const secCell = ws.getCell(curRow, 1);
    secCell.value = `${section.displayTitle}  —  ${section.subs.length} image(s)`;
    secCell.font  = { bold: true, size: 12, color: { argb: CLR.sectionFg } };
    secCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.sectionBg } };
    secCell.alignment = { vertical: "middle" };
    ws.mergeCells(curRow, 1, curRow, TOTAL_COLS);
    for (let c = 1; c <= TOTAL_COLS; c++) {
      ws.getCell(curRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.sectionBg } };
    }
    curRow++;

    let slot = 0;
    let rowStart = curRow;

    for (const sub of section.subs) {
      const col = (slot % COLS_PER_ROW) * SLOT_W + 1;

      if (slot % COLS_PER_ROW === 0 && slot > 0) {
        rowStart = curRow;
      }

      const labelRow = rowStart;
      ws.getRow(labelRow).height = 16;
      const labelCell = ws.getCell(labelRow, col);
      labelCell.value = sub.subtitle;
      labelCell.font  = { bold: true, size: 10, color: { argb: "FF1F3864" } };
      labelCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.rowBg } };
      labelCell.alignment = { vertical: "middle", wrapText: true };
      ws.mergeCells(labelRow, col, labelRow, col + SLOT_W - 1);

      const countRow = labelRow + 1;
      ws.getRow(countRow).height = 14;
      const countCell = ws.getCell(countRow, col);
      countCell.value = `${sub.partCount} hotspot part(s)`;
      countCell.font  = { italic: true, size: 9, color: { argb: "FF607182" } };
      countCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.imageBg } };
      ws.mergeCells(countRow, col, countRow, col + SLOT_W - 1);

      const imgStartRow = countRow + 1;
      const IMG_ROWS = 14;
      for (let r = imgStartRow; r < imgStartRow + IMG_ROWS; r++) {
        ws.getRow(r).height = IMG_ROW_HEIGHT / IMG_ROWS;
        for (let c = col; c < col + SLOT_W; c++) {
          ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.imageBg } };
        }
      }

      try {
        const imgId = ws.workbook.addImage({
          filename  : sub.imgPath,
          extension : sub.ext === "gif" ? "gif" : "png",
        });
        ws.addImage(imgId, {
          tl     : { col: col - 1,          row: imgStartRow - 1 },
          br     : { col: col - 1 + SLOT_W, row: imgStartRow - 1 + IMG_ROWS },
          editAs : "oneCell",
        });
      } catch (e) {
        const errCell = ws.getCell(imgStartRow, col);
        errCell.value = `[Image error: ${e.message}]`;
        errCell.font  = { italic: true, size: 9, color: { argb: "FFCC0000" } };
      }

      slot++;

      if (slot % COLS_PER_ROW === 0) {
        curRow = imgStartRow + IMG_ROWS + 1;
        ws.getRow(curRow - 1).height = 6;
        rowStart = curRow;
      }
    }

    if (slot % COLS_PER_ROW !== 0) {
      curRow = rowStart + 1 + 1 + 14 + 1;
      ws.getRow(curRow - 1).height = 6;
    }

    ws.getRow(curRow).height = 8;
    curRow++;
  }

  return totalImages;
}

async function main() {
  console.log("Loading catalog-data.json ...");
  const raw     = fs.readFileSync(JSON_PATH, "utf8").replace(/^\uFEFF/, "");
  const catalog = JSON.parse(raw);

  const merged = buildMergedSections(catalog);
  const allSections = buildAllGallerySections(catalog);
  const extraSections = buildNotInMasterSections(merged);

  const totalAll = allSections.reduce((n, s) => n + s.subs.length, 0);
  const totalExtra = extraSections.reduce((n, s) => n + s.subs.length, 0);

  console.log(`  Diagram Gallery (all)     : ${totalAll} images, ${allSections.length} systems`);
  console.log(`  Not in Master Catalog     : ${totalExtra} images, ${extraSections.length} systems`);

  console.log("Opening workbook ...");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(OUTPUT);

  removeSheetByName(wb, "Diagram Gallery");
  removeSheetByName(wb, "Not in Master Catalog");

  const wsAll = wb.addWorksheet("Diagram Gallery", {
    properties : { tabColor: { argb: "FF2E75B6" } },
  });
  populateGallerySheet(
    wsAll,
    allSections,
    "Diagram Gallery — All Sub-System Images",
    `${totalAll} diagrams across ${allSections.length} systems  •  local GIF / PNG images`
  );

  const wsExtra = wb.addWorksheet("Not in Master Catalog", {
    properties : { tabColor: { argb: CLR.accentTab } },
  });
  populateGallerySheet(
    wsExtra,
    extraSections,
    "Not in Master Catalog — Gallery images omitted from Master sheet",
    `${totalExtra} diagrams  •  Excludes the one image per system shown on \"Master Catalog\" (same file path as embedded there)`
  );

  console.log("Saving workbook (this may take a moment) ...");
  const outTmp = OUTPUT.replace(/\.xlsx$/i, "_NEW.xlsx");
  try {
    await wb.xlsx.writeFile(OUTPUT);
  } catch (e) {
    if (e.code === "EBUSY") {
      await wb.xlsx.writeFile(outTmp);
      console.log(`\n[WARN] ${OUTPUT} is locked — saved to ${outTmp}`);
      console.log("       Close Excel and rename _NEW.xlsx to replace the master file.");
    } else {
      throw e;
    }
  }

  console.log(`\nDone!`);
  console.log(`  "Diagram Gallery"        : ${totalAll} images`);
  console.log(`  "Not in Master Catalog"  : ${totalExtra} images`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

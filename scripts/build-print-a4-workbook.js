"use strict";
/**
 * build-print-a4-workbook.js
 *
 * Builds "R35 Diagram Prints A4.xlsx" — one worksheet per image, each sheet
 * set up for A4 portrait so printing the whole workbook yields one image per page.
 *
 * Put images in:  assets/print-selection/
 * Or run:  node scripts/build-print-a4-workbook.js <folder> [maxCount]
 *
 * Examples:
 *   node scripts/build-print-a4-workbook.js
 *   node scripts/build-print-a4-workbook.js assets/print-selection
 *   node scripts/build-print-a4-workbook.js assets/diagrams/api 25
 */

const path    = require("path");
const fs      = require("fs");
const ExcelJS = require("exceljs");
const sharp   = require("sharp");

const ROOT = path.join(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT, "assets", "print-selection");
const OUTPUT = path.join(ROOT, "R35 Diagram Prints A4.xlsx");

const MAX_W = 720;
const MAX_H = 980;

const IMG_EXT = new Set([".png", ".gif", ".jpg", ".jpeg", ".webp", ".bmp"]);

function sheetNameSafe(base, index, used) {
  let s = `P${String(index).padStart(2, "0")}-${base}`;
  s = s.replace(/[:\\/?*[\]]/g, "-").replace(/\s+/g, " ").trim();
  if (s.length > 31) s = s.slice(0, 31).replace(/-+$/, "");
  let out = s;
  let n = 1;
  while (used.has(out)) {
    const suffix = `-${n++}`;
    out = (s.slice(0, 31 - suffix.length) + suffix).slice(0, 31);
  }
  used.add(out);
  return out;
}

function listImageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => IMG_EXT.has(path.extname(f).toLowerCase()))
    .map(f => path.join(dir, f))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

async function computeSize(fullPath) {
  const meta = await sharp(fullPath).metadata();
  const w = meta.width || MAX_W;
  const h = meta.height || MAX_H;
  const scale = Math.min(MAX_W / w, MAX_H / h, 1);
  return {
    width  : Math.max(1, Math.round(w * scale)),
    height : Math.max(1, Math.round(h * scale)),
  };
}

/** Returns { path, extension } for Excel addImage — converts exotic formats to a temp PNG. */
async function ensureExcelImage(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  const base = [".png", ".jpg", ".jpeg", ".gif"];
  if (base.includes(ext)) {
    const e = ext === ".jpg" ? "jpeg" : ext.slice(1);
    return { path: fullPath, extension: e, cleanup: null };
  }
  const tmp = path.join(ROOT, `.print-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await sharp(fullPath).png().toFile(tmp);
  return { path: tmp, extension: "png", cleanup: tmp };
}

async function main() {
  const inputDir = path.resolve(process.argv[2] || DEFAULT_INPUT);
  const maxSheets = parseInt(process.argv[3] || "0", 10) || 0;

  let files = listImageFiles(inputDir);
  if (maxSheets > 0) files = files.slice(0, maxSheets);

  if (files.length === 0) {
    console.error(`No images found in:\n  ${inputDir}\n`);
    console.error("Put your diagram files here (or pass another folder).");
    console.error("Formats: .png .gif .jpg .jpeg .webp .bmp");
    console.error("\nOptional: node scripts/build-print-a4-workbook.js <folder> <maxCount>");
    process.exit(1);
  }

  if (!fs.existsSync(path.dirname(DEFAULT_INPUT))) {
    fs.mkdirSync(path.dirname(DEFAULT_INPUT), { recursive: true });
  }

  console.log(`Input: ${inputDir}`);
  console.log(`Sheets: ${files.length}${maxSheets ? ` (limited to ${maxSheets})` : ""}\n`);

  const wb = new ExcelJS.Workbook();
  wb.creator = "R35 Catalog";
  wb.created = new Date();

  const usedNames = new Set();
  const tempFiles = [];

  for (let i = 0; i < files.length; i++) {
    const fullPath = files[i];
    const base = path.basename(fullPath, path.extname(fullPath));
    const sheetName = sheetNameSafe(base, i + 1, usedNames);

    const ws = wb.addWorksheet(sheetName, {
      pageSetup: {
        paperSize   : 9,
        orientation : "portrait",
        fitToPage   : true,
        fitToWidth  : 1,
        fitToHeight : 1,
        margins: {
          left   : 0.35,
          right  : 0.35,
          top    : 0.45,
          bottom : 0.45,
          header : 0.2,
          footer : 0.2,
        },
      },
      properties: { tabColor: { argb: "FF4472C4" } },
    });

    ws.getRow(1).height = 24;
    const title = ws.getCell(1, 1);
    title.value = base;
    title.font = { bold: true, size: 12, color: { argb: "FF1F3864" } };
    title.alignment = { vertical: "middle" };
    ws.mergeCells(1, 1, 1, 10);

    let disp;
    try {
      disp = await computeSize(fullPath);
    } catch (e) {
      console.warn(`  [skip] ${base}: ${e.message}`);
      wb.removeWorksheet(sheetName);
      usedNames.delete(sheetName);
      continue;
    }

    let prepared;
    try {
      prepared = await ensureExcelImage(fullPath);
      if (prepared.cleanup) tempFiles.push(prepared.cleanup);
    } catch (e) {
      console.warn(`  [skip] ${base}: ${e.message}`);
      wb.removeWorksheet(sheetName);
      usedNames.delete(sheetName);
      continue;
    }

    try {
      const imgId = wb.addImage({
        filename  : prepared.path,
        extension : prepared.extension,
      });
      ws.addImage(imgId, {
        tl  : { col: 0, row: 1 },
        ext : { width: disp.width, height: disp.height },
      });
    } catch (e) {
      console.warn(`  [skip] ${base}: ${e.message}`);
      wb.removeWorksheet(sheetName);
      usedNames.delete(sheetName);
      continue;
    }

    for (let c = 1; c <= 10; c++) ws.getColumn(c).width = 11;

    process.stdout.write(`\r  [${i + 1}/${files.length}] ${sheetName}`.padEnd(72));
  }

  for (const t of tempFiles) {
    try { fs.unlinkSync(t); } catch { /* ignore */ }
  }

  console.log("\n\nWriting file ...");
  await wb.xlsx.writeFile(OUTPUT);

  console.log(`\nCreated: ${OUTPUT}`);
  console.log("Print in Excel: File → Print → select \"Print Entire Workbook\" (or Ctrl+P).");
  console.log("Each tab is one A4 page with Fit-to-page enabled.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

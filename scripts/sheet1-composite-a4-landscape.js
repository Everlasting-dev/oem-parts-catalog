"use strict";
/**
 * sheet1-composite-a4-landscape.js
 *
 * Reads an Excel file (default: R35 Master Parts Catalog_NEW.xlsx), extracts every
 * embedded picture from "Sheet1" / "Sheet 1", and builds a NEW workbook where
 * EACH image is on its OWN worksheet — A4 **landscape**, fit to one page.
 * Printing the whole workbook = one diagram per printed page (48 pages for 48 images).
 *
 * Output: R35 Sheet1 Print A4 Landscape.xlsx
 *
 * Usage:
 *   node scripts/sheet1-composite-a4-landscape.js
 *   node scripts/sheet1-composite-a4-landscape.js "path/to/file.xlsx" "Sheet1"
 */

const path    = require("path");
const fs      = require("fs");
const ExcelJS = require("exceljs");
const sharp   = require("sharp");

const ROOT = path.join(__dirname, "..");

const DEFAULT_BOOK = path.join(ROOT, "R35 Master Parts Catalog_NEW.xlsx");
const OUT_XLSX     = path.join(ROOT, "R35 Sheet1 Print A4 Landscape.xlsx");

/** Max pixel size for the image on the sheet (landscape: wide × shorter) */
const MAX_LANDSCAPE_W = 1100;
const MAX_LANDSCAPE_H = 780;

function findSheet(wb, name) {
  const candidates = [name, "Sheet1", "Sheet 1", "sheet1"];
  for (const c of candidates) {
    const ws = wb.getWorksheet(c);
    if (ws) return ws;
  }
  return wb.worksheets.find(w => w.name.toLowerCase() === String(name).toLowerCase()) || null;
}

function sheetNameForIndex(pageIndex) {
  const s = `P${String(pageIndex).padStart(2, "0")}`;
  return s.length <= 31 ? s : s.slice(0, 31);
}

async function sizeForLandscape(buf) {
  const meta = await sharp(buf).metadata();
  const w = meta.width || MAX_LANDSCAPE_W;
  const h = meta.height || MAX_LANDSCAPE_H;
  const scale = Math.min(MAX_LANDSCAPE_W / w, MAX_LANDSCAPE_H / h, 1);
  return {
    width  : Math.max(1, Math.round(w * scale)),
    height : Math.max(1, Math.round(h * scale)),
  };
}

async function toPngForExcel(buf, w, h) {
  return sharp(buf)
    .resize(w, h, {
      fit       : "inside",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
}

async function main() {
  const bookPath = path.resolve(process.argv[2] || DEFAULT_BOOK);
  const sheetArg = process.argv[3] || "Sheet1";

  if (!fs.existsSync(bookPath)) {
    console.error("File not found:", bookPath);
    process.exit(1);
  }

  console.log("Reading:", bookPath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(bookPath);

  const ws = findSheet(wb, sheetArg);
  if (!ws) {
    console.error("Sheet not found. Available:", wb.worksheets.map(w => w.name).join(", "));
    process.exit(1);
  }

  const rawImages = ws.getImages();
  const ordered = rawImages
    .map(im => ({
      imageId: im.imageId,
      row     : im.range.tl.nativeRow,
      col     : im.range.tl.nativeCol,
    }))
    .sort((a, b) => a.row - b.row || a.col - b.col);

  const buffers = [];
  for (const item of ordered) {
    const media = wb.getImage(item.imageId);
    if (!media || !media.buffer) {
      console.warn("Missing buffer for imageId", item.imageId);
      continue;
    }
    buffers.push(media.buffer);
  }

  const total = buffers.length;
  console.log(`Sheet "${ws.name}": ${total} image(s) → ${total} worksheets (1 per A4 landscape page)\n`);

  if (total === 0) {
    console.error("No images found.");
    process.exit(1);
  }

  const outWb = new ExcelJS.Workbook();
  outWb.creator = "R35 Catalog";
  outWb.created = new Date();

  for (let i = 0; i < buffers.length; i++) {
    const sheetName = sheetNameForIndex(i + 1);

    const printWs = outWb.addWorksheet(sheetName, {
      pageSetup: {
        paperSize   : 9,
        orientation : "landscape",
        fitToPage   : true,
        fitToWidth  : 1,
        fitToHeight : 1,
        margins: {
          left   : 0.35,
          right  : 0.35,
          top    : 0.4,
          bottom : 0.4,
          header : 0.15,
          footer : 0.15,
        },
      },
      properties: { tabColor: { argb: "FF1565C0" } },
    });

    printWs.getRow(1).height = 20;
    const cap = printWs.getCell(1, 1);
    cap.value = `Sheet1 — page ${i + 1} of ${total} (A4 landscape)`;
    cap.font = { size: 11, color: { argb: "FF37474F" } };
    cap.alignment = { vertical: "middle" };
    printWs.mergeCells(1, 1, 1, 12);

    let disp;
    let pngBuf;
    try {
      disp = await sizeForLandscape(buffers[i]);
      pngBuf = await toPngForExcel(buffers[i], disp.width, disp.height);
    } catch (e) {
      console.warn(`  [skip ${i + 1}] ${e.message}`);
      outWb.removeWorksheet(sheetName);
      continue;
    }

    const imgId = outWb.addImage({
      buffer    : pngBuf,
      extension : "png",
    });

    printWs.addImage(imgId, {
      tl  : { col: 0, row: 1 },
      ext : { width: disp.width, height: disp.height },
    });

    for (let c = 1; c <= 12; c++) printWs.getColumn(c).width = 11;
    printWs.getRow(2).height = Math.min(409, Math.ceil(disp.height * 0.72));

    process.stdout.write(`\r  [${i + 1}/${total}] ${sheetName}`.padEnd(64));
  }

  console.log("\n\nWriting:", OUT_XLSX);
  await outWb.xlsx.writeFile(OUT_XLSX);

  console.log("\nDone.");
  console.log(`  ${total} sheets — print: File → Print → Entire workbook (${total} pages).`);
  console.log("  Each page is A4 landscape with ONE image.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

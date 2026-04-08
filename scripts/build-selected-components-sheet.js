"use strict";

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

const ROOT = path.join(__dirname, "..");
const WORKBOOK_PATH = path.join(ROOT, "data", "master_parts_lab.xlsx");
const BACKUP_PATH = path.join(ROOT, "data", "master_parts_lab.backup-before-selected-components.xlsx");
const TEMP_OUTPUT_PATH = path.join(ROOT, "data", "master_parts_lab.selected-components.tmp.xlsx");
const SELECTED_DIR = path.join(ROOT, "data", "selected components");
const CATALOG_PATH = path.join(ROOT, "data", "catalog-data.json");
const REPORT_PATH = path.join(ROOT, "data", "selected-components-report.json");

const SHEET_SOURCE = "Master Catalog";
const SHEET_TARGET = "selected components";

const IMG_COLS = 8;
const DATA_COL0 = IMG_COLS + 1;
const COL_HEADERS = ["OEM", "Description", "Applies / Details", "Period", "Notes", "Match"];
const TOTAL_COLS = DATA_COL0 + COL_HEADERS.length - 1;

const CLR = {
  sectionBg: "FF1F3864",
  sectionFg: "FFFFFFFF",
  specBg: "FFD6E4F7",
  specFg: "FF1F3864",
  colHdrBg: "FF2E75B6",
  colHdrFg: "FFFFFFFF",
  rowEven: "FFF2F7FF",
  rowOdd: null,
  imageBg: "FFF0F4FA",
  borderClr: "FFB4C6D8",
  mutedFg: "FF666666",
  warnBg: "FFFFF2CC",
  warnFg: "FF7F6000",
};

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.png$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeLabel(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9+\-]/g, "");
}

function ocrCanonical(value) {
  return normalizeLabel(value)
    .replace(/[OQD]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/G/g, "6");
}

function weightedDistance(a, b) {
  const aa = normalizeLabel(a);
  const bb = normalizeLabel(b);
  const dp = Array.from({ length: aa.length + 1 }, () => Array(bb.length + 1).fill(0));

  for (let i = 0; i <= aa.length; i++) dp[i][0] = i;
  for (let j = 0; j <= bb.length; j++) dp[0][j] = j;

  const confusable = new Set([
    "0O", "O0", "0Q", "Q0", "0D", "D0",
    "1I", "I1", "1L", "L1",
    "5S", "S5",
    "6G", "G6",
    "8B", "B8",
    "2Z", "Z2",
    "P F", "F P",
  ]);

  for (let i = 1; i <= aa.length; i++) {
    for (let j = 1; j <= bb.length; j++) {
      const ca = aa[i - 1];
      const cb = bb[j - 1];
      let cost = 1;
      if (ca === cb) {
        cost = 0;
      } else if (ocrCanonical(ca) === ocrCanonical(cb)) {
        cost = 0.25;
      } else if (confusable.has(`${ca}${cb}`)) {
        cost = 0.4;
      }
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[aa.length][bb.length];
}

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

function cloneValue(value) {
  if (value && typeof value === "object") {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
}

function copyCellVisual(src, dst) {
  dst.style = cloneStyle(src.style);
  if (src.numFmt) dst.numFmt = src.numFmt;
  if (src.alignment) dst.alignment = cloneStyle(src.alignment);
  if (src.font) dst.font = cloneStyle(src.font);
  if (src.fill) dst.fill = cloneStyle(src.fill);
  if (src.border) dst.border = cloneStyle(src.border);
}

function loadCatalog() {
  const raw = fs.readFileSync(CATALOG_PATH, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function parseMasterSections(ws) {
  const sections = [];
  let current = null;

  for (let row = 4; row <= ws.rowCount; row++) {
    const titleText = String(ws.getCell(row, 1).text || "").trim();
    const oemText = String(ws.getCell(row, 9).text || "").trim();
    const isHeader = /^\d{3}\s+-\s+/.test(titleText);

    if (isHeader) {
      if (current) {
        sections.push(finalizeSection(ws, current, row - 1));
      }

      const cleanTitle = titleText.split("|")[0].trim();
      const match = cleanTitle.match(/^(\d{3})\s+-\s+(.+)$/);
      current = {
        label: cleanTitle,
        number: match ? match[1] : "",
        title: match ? match[2].trim() : cleanTitle,
        headerRow: row,
        specRow: row + 1,
        columnHeaderRow: row + 2,
        dataStartRow: row + 3,
      };
      continue;
    }

    if (!current) continue;

    // keep scanning until the next section header
    if (!oemText && row > current.dataStartRow && row < ws.rowCount) {
      const nextTitle = String(ws.getCell(row + 1, 1).text || "").trim();
      if (/^\d{3}\s+-\s+/.test(nextTitle)) {
        sections.push(finalizeSection(ws, current, row));
        current = null;
      }
    }
  }

  if (current) {
    sections.push(finalizeSection(ws, current, ws.rowCount));
  }

  return sections;
}

function finalizeSection(ws, section, scanEndRow) {
  let dataEndRow = section.dataStartRow - 1;
  for (let row = section.dataStartRow; row <= scanEndRow; row++) {
    const rowHasContent = Array.from({ length: TOTAL_COLS }, (_, idx) =>
      String(ws.getCell(row, idx + 1).text || "").trim()
    ).some(Boolean);
    if (rowHasContent) dataEndRow = row;
  }

  while (dataEndRow >= section.dataStartRow) {
    const hasData = String(ws.getCell(dataEndRow, 9).text || "").trim();
    if (hasData) break;
    dataEndRow--;
  }

  const rows = [];
  for (let row = section.dataStartRow; row <= dataEndRow; row++) {
    const oem = String(ws.getCell(row, 9).text || "").trim();
    if (!oem) continue;

    const values = [];
    for (let col = 9; col <= 14; col++) {
      values.push(String(ws.getCell(row, col).text || ""));
    }

    rows.push({
      sourceRow: row,
      oem,
      values,
      matchValue: String(ws.getCell(row, 14).text || ""),
      styleSourceRow: row,
    });
  }

  const rowMap = new Map();
  for (const row of rows) {
    if (!rowMap.has(row.oem)) rowMap.set(row.oem, []);
    rowMap.get(row.oem).push(row);
  }

  return {
    ...section,
    dataEndRow,
    separatorRow: dataEndRow + 1,
    rows,
    rowMap,
  };
}

async function preprocessImage(imagePath) {
  const meta = await sharp(imagePath).metadata();
  const targetWidth = Math.max(1600, meta.width || 1600);
  return sharp(imagePath)
    .resize(targetWidth, null, { kernel: sharp.kernel.lanczos3 })
    .grayscale()
    .normalise()
    .sharpen({ sigma: 0.9 })
    .png()
    .toBuffer();
}

async function ocrImage(worker, imagePath) {
  const buffer = await preprocessImage(imagePath);
  const result = await worker.recognize(buffer, {}, { blocks: true });
  const tokens = [];

  for (const block of result.data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) {
          const raw = String(word.text || "").trim();
          if (!raw) continue;
          const normalized = normalizeLabel(raw);
          if (!normalized || normalized.length < 4) continue;
          tokens.push({
            raw,
            normalized,
            confidence: word.confidence ?? 0,
          });
        }
      }
    }
  }

  return tokens;
}

function pickBestDiagram(diagrams, tokens) {
  let best = null;

  for (const diagram of diagrams) {
    const calloutMap = new Map();
    for (const hotspot of diagram.hotspots || []) {
      const key = normalizeLabel(hotspot.callout);
      if (!key) continue;
      if (!calloutMap.has(key)) calloutMap.set(key, []);
      calloutMap.get(key).push(hotspot.partNumber);
    }

    const matched = new Map();
    const unmatchedTokens = [];
    let score = 0;

    for (const token of tokens) {
      const match = bestCalloutMatch(token.normalized, [...calloutMap.keys()]);
      if (match) {
        matched.set(match.callout, {
          callout: match.callout,
          rawToken: token.raw,
          confidence: token.confidence,
          distance: match.distance,
          partNumbers: calloutMap.get(match.callout) || [],
        });
        score += Math.max(0.1, 3 - match.distance);
      } else {
        unmatchedTokens.push(token);
      }
    }

    score += matched.size * 10;

    if (!best || score > best.score) {
      best = {
        diagram,
        score,
        matched,
        unmatchedTokens,
      };
    }
  }

  return best;
}

function bestCalloutMatch(token, callouts) {
  const normalizedToken = normalizeLabel(token);
  const strippedToken = normalizedToken.replace(/^[A-Z](?=\d{4,})/, "");
  const candidates = [normalizedToken, strippedToken].filter(Boolean);

  let best = null;
  for (const callout of callouts) {
    for (const candidate of candidates) {
      const exact = candidate === callout;
      const canonicalExact = ocrCanonical(candidate) === ocrCanonical(callout);
      const distance = exact ? 0 : canonicalExact ? 0.2 : weightedDistance(candidate, callout);
      const lengthGap = Math.abs(candidate.length - callout.length);
      if (distance > 1.5 || lengthGap > 2) continue;
      if (!best || distance < best.distance) {
        best = { callout, distance };
      }
    }
  }
  return best;
}

function buildSelectionForFile(fileName, sectionsByTitle, diagramsByTitle, worker) {
  return (async () => {
    const imagePath = path.join(SELECTED_DIR, fileName);
    const titleKey = normalizeName(fileName);
    const sourceSection = sectionsByTitle.get(titleKey);
    const diagrams = diagramsByTitle.get(titleKey) || [];
    const tokens = await ocrImage(worker, imagePath);
    const bestDiagram = diagrams.length ? pickBestDiagram(diagrams, tokens) : null;

    const selectedRows = [];
    const seenSourceRows = new Set();
    const flags = [];

    if (!sourceSection) {
      flags.push(`No matching section found in "${SHEET_SOURCE}" for "${fileName}".`);
    }

    if (!diagrams.length) {
      flags.push(`No matching catalog diagram found for "${fileName}".`);
    }

    if (bestDiagram) {
      const matchedEntries = [...bestDiagram.matched.values()].sort((a, b) =>
        a.callout.localeCompare(b.callout, undefined, { numeric: true })
      );

      for (const entry of matchedEntries) {
        const partNumbers = [...new Set(entry.partNumbers.filter(Boolean))];
        if (!partNumbers.length) {
          flags.push(`Callout ${entry.callout} was OCR-matched but has no linked OEM part number in catalog data.`);
          continue;
        }

        let foundAny = false;
        for (const partNumber of partNumbers) {
          const sectionRows = sourceSection?.rowMap.get(partNumber) || [];
          if (sectionRows.length) foundAny = true;
          for (const row of sectionRows) {
            if (seenSourceRows.has(row.sourceRow)) continue;
            seenSourceRows.add(row.sourceRow);
            selectedRows.push({
              type: "data",
              sourceRow: row.sourceRow,
              values: [...row.values.slice(0, 5), mergeMatchValue(row.values[5], `OCR ${entry.callout}`)],
            });
          }
        }

        if (!foundAny) {
          flags.push(`Callout ${entry.callout} matched catalog OEM ${partNumbers.join(", ")} but no row was found in "${SHEET_SOURCE}".`);
        }
      }

      for (const token of bestDiagram.unmatchedTokens) {
        if (token.normalized.length < 5) continue;
        flags.push(`Unmatched OCR token "${token.raw}" from "${fileName}".`);
      }
    } else if (!tokens.length) {
      flags.push(`OCR returned no usable labels for "${fileName}".`);
    } else {
      flags.push(`OCR found labels for "${fileName}", but no diagram variant could be matched confidently.`);
    }

    selectedRows.sort((a, b) => a.sourceRow - b.sourceRow);

    for (const flag of flags) {
      selectedRows.push({
        type: "flag",
        values: ["", "", "", "", "", `FLAG: ${flag}`],
      });
    }

    const sectionLabel = sourceSection?.label || fileName.replace(/\.png$/i, "");
    const specText = sourceSection ? String(sourceSection.title || "") : fileName.replace(/\.png$/i, "");

    return {
      fileName,
      imagePath,
      titleKey,
      sectionLabel,
      sectionTitle: sourceSection?.title || fileName.replace(/\.png$/i, ""),
      specSource: sourceSection,
      bestDiagramId: bestDiagram?.diagram?.id || null,
      ocrTokenCount: tokens.length,
      matchedCallouts: bestDiagram ? [...bestDiagram.matched.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [],
      selectedRows,
      flags,
      specText,
    };
  })();
}

function mergeMatchValue(existing, extra) {
  const left = String(existing || "").trim();
  const right = String(extra || "").trim();
  if (!left) return right;
  if (!right) return left;
  if (left.includes(right)) return left;
  return `${left}; ${right}`;
}

function copyWorksheetBasics(sourceWs, targetWs) {
  for (let col = 1; col <= TOTAL_COLS; col++) {
    targetWs.getColumn(col).width = sourceWs.getColumn(col).width;
    targetWs.getColumn(col).hidden = sourceWs.getColumn(col).hidden;
  }
  targetWs.views = sourceWs.views;
  targetWs.properties = { ...sourceWs.properties };
}

function applyTitleRows(sourceWs, targetWs) {
  for (const rowNumber of [1, 2]) {
    const srcRow = sourceWs.getRow(rowNumber);
    const dstRow = targetWs.getRow(rowNumber);
    dstRow.height = srcRow.height;
    for (let col = 1; col <= TOTAL_COLS; col++) {
      copyCellVisual(sourceWs.getCell(rowNumber, col), targetWs.getCell(rowNumber, col));
    }
  }

  targetWs.mergeCells(1, 1, 1, TOTAL_COLS);
  targetWs.mergeCells(2, 1, 2, TOTAL_COLS);
  targetWs.getCell(1, 1).value = "Nissan GT-R R35  —  Selected Components";
  targetWs.getCell(2, 1).value = "Only OCR-selected callouts from edited subcategory images";
}

function writeSection(targetWs, workbook, sourceWs, cursorRow, selection) {
  const template = selection.specSource;
  const dataRows = selection.selectedRows;
  const countLabel = `${selection.sectionLabel}  |  ${dataRows.filter(r => r.type === "data").length} matched part(s)`;

  const headerTemplateRow = template?.headerRow || 4;
  const specTemplateRow = template?.specRow || 5;
  const colHeaderTemplateRow = template?.columnHeaderRow || 6;
  const dataTemplateRow = template?.rows[0]?.sourceRow || 12;
  const blankTemplateRow = template?.separatorRow || 8;

  const headerRow = cursorRow;
  const specRow = cursorRow + 1;
  const colHeaderRow = cursorRow + 2;
  const dataStartRow = cursorRow + 3;

  copyStyledRow(sourceWs, headerTemplateRow, targetWs, headerRow);
  copyStyledRow(sourceWs, specTemplateRow, targetWs, specRow);
  copyStyledRow(sourceWs, colHeaderTemplateRow, targetWs, colHeaderRow);

  targetWs.mergeCells(headerRow, 1, headerRow, TOTAL_COLS);
  targetWs.mergeCells(specRow, 1, specRow, TOTAL_COLS);
  targetWs.getCell(headerRow, 1).value = countLabel;
  targetWs.getCell(specRow, 1).value = template
    ? sourceWs.getCell(template.specRow, 1).text
    : `Selected image: ${selection.sectionTitle}`;

  let currentRow = dataStartRow;

  if (!dataRows.length) {
    copyStyledRow(sourceWs, 7, targetWs, currentRow);
    targetWs.mergeCells(currentRow, DATA_COL0, currentRow, TOTAL_COLS);
    targetWs.getCell(currentRow, DATA_COL0).value = "(no selected parts found in edited image)";
    currentRow++;
  } else {
    dataRows.forEach((rowData, idx) => {
      copyStyledRow(sourceWs, dataTemplateRow, targetWs, currentRow);
      targetWs.getRow(currentRow).height = sourceWs.getRow(dataTemplateRow).height || 16;

      for (let col = 1; col <= IMG_COLS; col++) {
        const cell = targetWs.getCell(currentRow, col);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.imageBg } };
      }

      for (let i = 0; i < COL_HEADERS.length; i++) {
        const cell = targetWs.getCell(currentRow, DATA_COL0 + i);
        cell.value = rowData.values[i] || "";
        if (rowData.type === "flag") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.warnBg } };
          cell.font = { ...(cell.font || {}), color: { argb: CLR.warnFg }, italic: i === 5 };
        } else if (idx % 2 === 0 && i < 5) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR.rowEven } };
        }
      }

      currentRow++;
    });
  }

  copyStyledRow(sourceWs, blankTemplateRow, targetWs, currentRow);
  targetWs.getRow(currentRow).height = sourceWs.getRow(blankTemplateRow).height || 6;

  if (fs.existsSync(selection.imagePath)) {
    const imgId = workbook.addImage({
      filename: selection.imagePath,
      extension: "png",
    });
    const imgBottomRow = Math.max(currentRow - 1, colHeaderRow + 3);
    targetWs.addImage(imgId, {
      tl: { col: 0, row: colHeaderRow - 1 },
      br: { col: IMG_COLS, row: imgBottomRow },
      editAs: "oneCell",
    });
  }

  return currentRow + 1;
}

function copyStyledRow(sourceWs, sourceRowNumber, targetWs, targetRowNumber) {
  const srcRow = sourceWs.getRow(sourceRowNumber);
  const dstRow = targetWs.getRow(targetRowNumber);
  dstRow.height = srcRow.height;

  for (let col = 1; col <= TOTAL_COLS; col++) {
    const srcCell = sourceWs.getCell(sourceRowNumber, col);
    const dstCell = targetWs.getCell(targetRowNumber, col);
    copyCellVisual(srcCell, dstCell);
    dstCell.value = null;
  }
}

async function main() {
  if (!fs.existsSync(WORKBOOK_PATH)) {
    throw new Error(`Workbook not found: ${WORKBOOK_PATH}`);
  }
  if (!fs.existsSync(SELECTED_DIR)) {
    throw new Error(`Selected components directory not found: ${SELECTED_DIR}`);
  }

  if (!fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(WORKBOOK_PATH, BACKUP_PATH);
  }

  const selectedFiles = fs.readdirSync(SELECTED_DIR)
    .filter(name => /\.png$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const catalog = loadCatalog();
  const diagramsByTitle = new Map();
  for (const diagram of catalog.diagrams || []) {
    const key = normalizeName(diagram.title);
    if (!key) continue;
    if (!diagramsByTitle.has(key)) diagramsByTitle.set(key, []);
    diagramsByTitle.get(key).push(diagram);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const sourceWs = workbook.getWorksheet(SHEET_SOURCE);
  if (!sourceWs) {
    throw new Error(`Source sheet "${SHEET_SOURCE}" not found.`);
  }

  const sections = parseMasterSections(sourceWs);
  const sectionsByTitle = new Map(sections.map(section => [normalizeName(section.title), section]));

  const existing = workbook.getWorksheet(SHEET_TARGET);
  if (existing) workbook.removeWorksheet(existing.id);

  const targetWs = workbook.addWorksheet(SHEET_TARGET, {
    properties: { tabColor: { argb: "FF1F3864" } },
    views: sourceWs.views,
  });

  copyWorksheetBasics(sourceWs, targetWs);
  applyTitleRows(sourceWs, targetWs);

  const worker = await createWorker("eng", 1, { logger: () => {} });
  await worker.setParameters({
    tessedit_pageseg_mode: "11",
    user_defined_dpi: "200",
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-+",
  });

  const selections = [];
  try {
    for (const fileName of selectedFiles) {
      console.log(`OCR + match: ${fileName}`);
      selections.push(await buildSelectionForFile(fileName, sectionsByTitle, diagramsByTitle, worker));
    }
  } finally {
    await worker.terminate();
  }

  let cursorRow = 4;
  for (const selection of selections) {
    cursorRow = writeSection(targetWs, workbook, sourceWs, cursorRow, selection);
  }

  await workbook.xlsx.writeFile(TEMP_OUTPUT_PATH);

  const report = {
    generatedAt: new Date().toISOString(),
    workbook: path.relative(ROOT, WORKBOOK_PATH),
    tempWorkbook: path.relative(ROOT, TEMP_OUTPUT_PATH),
    backup: path.relative(ROOT, BACKUP_PATH),
    sheet: SHEET_TARGET,
    filesProcessed: selections.length,
    selections: selections.map(item => ({
      fileName: item.fileName,
      sectionTitle: item.sectionTitle,
      diagramId: item.bestDiagramId,
      matchedCallouts: item.matchedCallouts,
      selectedRowCount: item.selectedRows.filter(row => row.type === "data").length,
      flags: item.flags,
    })),
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log(`Wrote sheet "${SHEET_TARGET}" to temp workbook ${TEMP_OUTPUT_PATH}`);
  console.log(`Report: ${REPORT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

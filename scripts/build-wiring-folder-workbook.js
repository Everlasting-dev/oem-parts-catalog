"use strict";

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { writeCatalogBundles } = require("./write-catalog-bundles");

const ROOT = path.join(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "data", "catalog-data.json");
const OUTPUT_DIR = path.join(ROOT, "data", "wiring 2010,2013,2019");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "GT-R Wiring 2010-2013-2019 Parts Index.xlsx");

const PAGE_CONFIGS = [
  {
    order: 1,
    prefix: "amayama-wiring-12-2010-11-2013-premium-",
    pageVariantLabel: "2010 Wiring • 12.2010 - 11.2013 PREMIUM",
    pageDateRange: "12.2010 - 11.2013",
    pageTrim: "PREMIUM",
    sourceFile:
      "Wiring for Nissan GT-R R35, 12.2010 - 11.2013 PREMIUM VR38DETT GR6 - Nissan North America Car and Auto Spare Parts - Genuine Online Car Parts Catalogue - Amayama.html",
  },
  {
    order: 2,
    prefix: "amayama-wiring-11-2013-04-2019-premium-",
    pageVariantLabel: "2013 Wiring • 11.2013 - 04.2019 PREMIUM",
    pageDateRange: "11.2013 - 04.2019",
    pageTrim: "PREMIUM",
    sourceFile:
      "Wiring for Nissan GT-R R35, 11.2013 - 04.2019 PREMIUM VR38DETT GR6 - Nissan North America Car and Auto Spare Parts - Genuine Online Car Parts Catalogue - Amayama.html",
  },
  {
    order: 3,
    prefix: "amayama-wiring-04-2016-04-2019-pure-",
    pageVariantLabel: "2019 Wiring • 04.2016 - 04.2019 PURE",
    pageDateRange: "04.2016 - 04.2019",
    pageTrim: "PURE",
    sourceFile:
      "Wiring for Nissan GT-R R35, 04.2016 - 04.2019 PURE VR38DETT GR6 - Nissan North America Car and Auto Spare Parts - Genuine Online Car Parts Catalogue - Amayama.html",
  },
];

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8").replace(/^\uFEFF/, ""));
}

function writeCatalog(catalog) {
  const json = JSON.stringify(catalog, null, 2);
  fs.writeFileSync(CATALOG_PATH, json, "utf8");
  writeCatalogBundles(catalog, { projectRoot: ROOT });
}

function splitBulletText(text) {
  return String(text || "")
    .split(/•|â€¢/)
    .map(chunk => chunk.trim())
    .filter(Boolean);
}

function parseDiagramMeta(diagram) {
  const chunks = splitBulletText(diagram.subtitle || "");
  return {
    wiringType: chunks[0] || "",
    wiringDate: chunks[1] || "",
    appliesTo: chunks.slice(2).join(" • "),
  };
}

function parseDiagramCode(diagramId) {
  const match = String(diagramId).match(/240a-(\d+)-(\d+)$/i);
  return {
    pnc: match ? Number(match[1]) : Number.MAX_SAFE_INTEGER,
    variant: match ? Number(match[2]) : Number.MAX_SAFE_INTEGER,
  };
}

function compareDiagrams(a, b) {
  const aCode = parseDiagramCode(a.id);
  const bCode = parseDiagramCode(b.id);
  return (
    aCode.pnc - bCode.pnc ||
    aCode.variant - bCode.variant ||
    String(a.subtitle || "").localeCompare(String(b.subtitle || "")) ||
    String(a.id).localeCompare(String(b.id))
  );
}

function compareRows(a, b) {
  return (
    a.pageOrder - b.pageOrder ||
    a.diagramPnc - b.diagramPnc ||
    a.diagramVariant - b.diagramVariant ||
    String(a.callout).localeCompare(String(b.callout), undefined, { numeric: true }) ||
    String(a.partNumber).localeCompare(String(b.partNumber))
  );
}

function makeSortKey(pageOrder, diagramId) {
  const code = parseDiagramCode(diagramId);
  return [
    String(pageOrder).padStart(2, "0"),
    String(code.pnc).padStart(3, "0"),
    String(code.variant).padStart(2, "0"),
  ].join("-");
}

function buildRows(catalog) {
  const partMap = new Map((catalog.parts || []).map(part => [part.partNumber, part]));
  const rows = [];

  for (const config of PAGE_CONFIGS) {
    const diagrams = (catalog.diagrams || [])
      .filter(diagram => String(diagram.id).startsWith(config.prefix))
      .sort(compareDiagrams);

    for (const diagram of diagrams) {
      const meta = parseDiagramMeta(diagram);
      const code = parseDiagramCode(diagram.id);
      const seen = new Set();

      for (const hotspot of (diagram.hotspots || []).slice().sort((a, b) =>
        String(a.callout || "").localeCompare(String(b.callout || ""), undefined, { numeric: true }) ||
        String(a.partNumber || "").localeCompare(String(b.partNumber || ""))
      )) {
        if (!hotspot.partNumber) continue;
        const rowKey = `${diagram.id}|${hotspot.callout || ""}|${hotspot.partNumber}`;
        if (seen.has(rowKey)) continue;
        seen.add(rowKey);

        const part = partMap.get(hotspot.partNumber) || {};
        rows.push({
          pageOrder: config.order,
          pageVariantLabel: config.pageVariantLabel,
          pageDateRange: config.pageDateRange,
          pageTrim: config.pageTrim,
          sourceFile: config.sourceFile,
          diagramId: diagram.id,
          diagramPnc: code.pnc,
          diagramVariant: code.variant,
          wiringType: meta.wiringType,
          wiringDate: meta.wiringDate,
          appliesTo: meta.appliesTo,
          callout: hotspot.callout || "",
          partNumber: hotspot.partNumber,
          description: part.description || "",
          requiredQty: part.requiredQty || "",
          partCatalogPeriod: part.period || "",
          notes: part.notes || "",
          supplierUrl: part.links?.[0]?.url || part.supplierUrl || "",
        });
      }
    }
  }

  return rows.sort(compareRows);
}

function updateCatalogMetadata(catalog) {
  let touched = 0;
  for (const config of PAGE_CONFIGS) {
    const diagrams = (catalog.diagrams || [])
      .filter(diagram => String(diagram.id).startsWith(config.prefix))
      .sort(compareDiagrams);

    for (const diagram of diagrams) {
      diagram.pageVariantLabel = config.pageVariantLabel;
      diagram.pageDateRange = config.pageDateRange;
      diagram.pageTrim = config.pageTrim;
      diagram.sortKey = makeSortKey(config.order, diagram.id);
      touched += 1;
    }
  }
  return touched;
}

async function buildWorkbook(rows) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Codex";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Page Version", key: "pageVariantLabel", width: 34 },
    { header: "Page Date Range", key: "pageDateRange", width: 18 },
    { header: "Trim", key: "pageTrim", width: 12 },
    { header: "Wiring Types", key: "wiringTypes", width: 48 },
    { header: "Unique Part Numbers", key: "uniqueParts", width: 18 },
    { header: "Rows", key: "rows", width: 10 },
  ];

  const detailSheet = workbook.addWorksheet("Wiring Parts");
  detailSheet.views = [{ state: "frozen", ySplit: 1 }];
  detailSheet.autoFilter = "A1:N1";
  detailSheet.columns = [
    { header: "Page Version", key: "pageVariantLabel", width: 34 },
    { header: "Page Date Range", key: "pageDateRange", width: 18 },
    { header: "Trim", key: "pageTrim", width: 12 },
    { header: "Wiring Type", key: "wiringType", width: 24 },
    { header: "Wiring Date", key: "wiringDate", width: 18 },
    { header: "Applies To", key: "appliesTo", width: 14 },
    { header: "Diagram Ref", key: "diagramRef", width: 12 },
    { header: "Callout", key: "callout", width: 10 },
    { header: "Part Number", key: "partNumber", width: 18 },
    { header: "Description", key: "description", width: 38 },
    { header: "Qty", key: "requiredQty", width: 10 },
    { header: "Catalog Period", key: "partCatalogPeriod", width: 18 },
    { header: "Notes", key: "notes", width: 30 },
    { header: "Supplier URL", key: "supplierUrl", width: 46 },
  ];

  const partSummarySheet = workbook.addWorksheet("Part Summary");
  partSummarySheet.views = [{ state: "frozen", ySplit: 1 }];
  partSummarySheet.autoFilter = "A1:G1";
  partSummarySheet.columns = [
    { header: "Part Number", key: "partNumber", width: 18 },
    { header: "Description", key: "description", width: 40 },
    { header: "Versions", key: "versions", width: 45 },
    { header: "Wiring Types", key: "wiringTypes", width: 36 },
    { header: "Wiring Dates", key: "wiringDates", width: 32 },
    { header: "Callouts", key: "callouts", width: 18 },
    { header: "Supplier URL", key: "supplierUrl", width: 46 },
  ];

  const groups = new Map();
  for (const row of rows) {
    const key = row.pageVariantLabel;
    if (!groups.has(key)) {
      groups.set(key, {
        pageVariantLabel: row.pageVariantLabel,
        pageDateRange: row.pageDateRange,
        pageTrim: row.pageTrim,
        wiringTypes: new Set(),
        uniqueParts: new Set(),
        rows: 0,
      });
    }
    const group = groups.get(key);
    if (row.wiringType) group.wiringTypes.add(row.wiringType);
    group.uniqueParts.add(row.partNumber);
    group.rows += 1;
  }

  for (const config of PAGE_CONFIGS) {
    const group = groups.get(config.pageVariantLabel);
    summarySheet.addRow({
      pageVariantLabel: config.pageVariantLabel,
      pageDateRange: config.pageDateRange,
      pageTrim: config.pageTrim,
      wiringTypes: group ? [...group.wiringTypes].sort().join(", ") : "",
      uniqueParts: group ? group.uniqueParts.size : 0,
      rows: group ? group.rows : 0,
    });
  }

  for (const row of rows) {
    detailSheet.addRow({
      ...row,
      diagramRef: Number.isFinite(row.diagramPnc)
        ? `240A-${String(row.diagramPnc).padStart(3, "0")}-${row.diagramVariant}`
        : row.diagramId,
    });
  }

  const partSummary = new Map();
  for (const row of rows) {
    if (!partSummary.has(row.partNumber)) {
      partSummary.set(row.partNumber, {
        partNumber: row.partNumber,
        description: row.description,
        versions: new Set(),
        wiringTypes: new Set(),
        wiringDates: new Set(),
        callouts: new Set(),
        supplierUrl: row.supplierUrl,
      });
    }
    const item = partSummary.get(row.partNumber);
    if (!item.description && row.description) item.description = row.description;
    if (!item.supplierUrl && row.supplierUrl) item.supplierUrl = row.supplierUrl;
    if (row.pageVariantLabel) item.versions.add(row.pageVariantLabel);
    if (row.wiringType) item.wiringTypes.add(row.wiringType);
    if (row.wiringDate) item.wiringDates.add(row.wiringDate);
    if (row.callout) item.callouts.add(row.callout);
  }

  for (const item of [...partSummary.values()].sort((a, b) => a.partNumber.localeCompare(b.partNumber))) {
    partSummarySheet.addRow({
      partNumber: item.partNumber,
      description: item.description,
      versions: [...item.versions].join(", "),
      wiringTypes: [...item.wiringTypes].sort().join(", "),
      wiringDates: [...item.wiringDates].sort().join(", "),
      callouts: [...item.callouts].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).join(", "),
      supplierUrl: item.supplierUrl,
    });
  }

  for (const sheet of [summarySheet, detailSheet, partSummarySheet]) {
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle", horizontal: "center" };
  }

  await workbook.xlsx.writeFile(OUTPUT_PATH);
}

async function main() {
  const catalog = loadCatalog();
  const touched = updateCatalogMetadata(catalog);
  writeCatalog(catalog);

  const rows = buildRows(catalog);
  await buildWorkbook(rows);

  console.log(`Updated ${touched} wiring diagrams in catalog-data.`);
  console.log(`Workbook rows: ${rows.length}`);
  console.log(`Workbook saved: ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

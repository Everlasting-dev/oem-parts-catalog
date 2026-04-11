const catalogBootstrap = window.CATALOG_BOOTSTRAP || {
  systems: [],
  categories: [],
  totalPartCount: 0,
  totalDiagramCount: 0,
  sources: [],
};

window.CATALOG_SYSTEM_CHUNKS = window.CATALOG_SYSTEM_CHUNKS || {};

const state = {
  activeCategoryKey: null,
  globalQuery: "",
  subsystemQuery: "",
  localQuery: "",
  activeSystemId: null,
  activeGroupId: null,
  activeDiagramId: null,
  activeRowKey: null,
  mobileView: "systems",
  mobileHotspotsVisible: false,
};

const partsByNumber = new Map();
const systemLoadPromises = new Map();
const scriptLoadPromises = new Map();

const SYSTEM_MERGE_ALIASES = new Map([
  ["alternator fitting", "alternator"],
  ["anti skid control chassis", "anti skid control"],
  ["wiring denso", "wiring"],
  ["manifold engine", "manifold"],
  ["floor panel rear", "floor panel"],
]);

const API_IMAGE_HOST_PREFIXES = new Map([
  ["epc.partsbooster.com", "51da2d"],
  ["nissan-img.amayama.com", "e97905"],
]);

const globalSearch = document.getElementById("global-search");
const subsystemSearch = document.getElementById("subsystem-search");
const localSearch = document.getElementById("local-search");
const localSearchLabel = document.getElementById("local-search-label");
const catalogShell = document.querySelector(".catalog-shell");
const mobileNavButtons = [...document.querySelectorAll(".mobile-nav-btn")];
const systemPanelKicker = document.getElementById("system-panel-kicker");
const systemPanelTitle = document.getElementById("system-panel-title");
const systemCount = document.getElementById("system-count");
const subsystemCount = document.getElementById("subsystem-count");
const systemList = document.getElementById("system-list");
const subsystemTitle = document.getElementById("subsystem-title");
const subsystemList = document.getElementById("subsystem-list");
const stageTitle = document.getElementById("stage-title");
const stageNote = document.getElementById("stage-note");
const matchCount = document.getElementById("match-count");
const stageContextBar = document.getElementById("stage-context-bar");
const stageBreadcrumbs = document.getElementById("stage-breadcrumbs");
const stageActions = document.getElementById("stage-actions");
const stageContent = document.getElementById("stage-content");
let isRestoringUrlState = false;
let currentStageSelection = null;

function initialiseSystemRecord(system) {
  const diagrams = (system.diagrams || []).map(diagram => ({
    ...diagram,
    _rowsBase: null,
    _rowQueryCache: new Map(),
    _hotspotTargets: null,
  }));
  const diagramMap = new Map(diagrams.map(diagram => [diagram.id, diagram]));
  const groups = (system.groups || []).map(group => ({
    ...group,
    diagramIds: [...(group.diagramIds || [])],
  }));

  return {
    ...system,
    diagrams,
    diagramMap,
    groups,
    groupMap: new Map(groups.map(group => [group.id, group])),
    isLoaded: false,
    loadError: "",
  };
}

const bootstrapSystems = (catalogBootstrap.systems || []).map(initialiseSystemRecord);
const bootstrapSystemsById = new Map(bootstrapSystems.map(system => [system.id, system]));
const bootstrapCategories = (catalogBootstrap.categories || [])
  .map(category => ({
    ...category,
    systemIds: [...(category.systemIds || [])],
    systems: (category.systemIds || [])
      .map(systemId => bootstrapSystemsById.get(systemId))
      .filter(Boolean),
  }))
  .filter(category => category.systems.length > 0);
const bootstrapCategoriesByKey = new Map(bootstrapCategories.map(category => [category.key, category]));

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getMotionBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}

function getGroupDiagrams(system, group) {
  if (!system || !group) return [];
  return (group.diagramIds || [])
    .map(diagramId => system.diagramMap.get(diagramId))
    .filter(Boolean);
}

function loadScript(src) {
  if (!src) return Promise.reject(new Error("Missing script path"));
  if (scriptLoadPromises.has(src)) return scriptLoadPromises.get(src);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  }).catch(error => {
    scriptLoadPromises.delete(src);
    throw error;
  });

  scriptLoadPromises.set(src, promise);
  return promise;
}

function mergeSystemChunk(system, chunk) {
  for (const part of chunk.parts || []) {
    if (!part?.partNumber) continue;
    partsByNumber.set(part.partNumber, part);
  }

  for (const fullDiagram of chunk.diagrams || []) {
    const existing = system.diagramMap.get(fullDiagram.id);
    if (existing) {
      Object.assign(existing, fullDiagram);
      existing._rowsBase = null;
      existing._rowQueryCache = new Map();
      existing._hotspotTargets = null;
      continue;
    }

    const nextDiagram = {
      ...fullDiagram,
      _rowsBase: null,
      _rowQueryCache: new Map(),
      _hotspotTargets: null,
    };
    system.diagrams.push(nextDiagram);
    system.diagramMap.set(nextDiagram.id, nextDiagram);
  }

  system.isLoaded = true;
  system.loadError = "";
}

function ensureSystemLoaded(systemId) {
  const system = bootstrapSystemsById.get(systemId);
  if (!system) return Promise.resolve(null);
  if (system.isLoaded) return Promise.resolve(system);
  if (systemLoadPromises.has(systemId)) return systemLoadPromises.get(systemId);

  const promise = loadScript(system.chunkPath)
    .then(() => {
      const chunk = window.CATALOG_SYSTEM_CHUNKS?.[systemId];
      if (!chunk) throw new Error(`Missing browser data for ${systemId}`);
      mergeSystemChunk(system, chunk);
      delete window.CATALOG_SYSTEM_CHUNKS[systemId];
      return system;
    })
    .catch(error => {
      system.loadError = error instanceof Error ? error.message : String(error);
      throw error;
    })
    .finally(() => {
      systemLoadPromises.delete(systemId);
    });

  systemLoadPromises.set(systemId, promise);
  return promise;
}

function requestSystemLoad(systemId) {
  if (!systemId || systemLoadPromises.has(systemId) || bootstrapSystemsById.get(systemId)?.isLoaded) return;
  ensureSystemLoaded(systemId)
    .then(() => {
      if (state.activeSystemId === systemId) render();
    })
    .catch(() => {
      if (state.activeSystemId === systemId) render();
    });
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function setMobileView(view) {
  state.mobileView = view;
  if (catalogShell) catalogShell.dataset.mobileView = view;
}

function syncMobileView() {
  if (!isMobileViewport()) {
    state.mobileHotspotsVisible = false;
    setMobileView("systems");
    return;
  }

  if (!state.activeSystemId && state.mobileView !== "systems") {
    setMobileView("systems");
    return;
  }

  setMobileView(state.mobileView || "systems");
}

function renderMobileNav() {
  const hasSystem = Boolean(state.activeSystemId);
  for (const button of mobileNavButtons) {
    const view = button.dataset.mobileView || "systems";
    button.classList.toggle("active", state.mobileView === view);
    button.disabled = (view === "subsystems" || view === "stage") && !hasSystem;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalise(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCase(text) {
  return String(text || "")
    .split(" ")
    .map(chunk => chunk ? chunk[0].toUpperCase() + chunk.slice(1) : chunk)
    .join(" ");
}

function cleanBulletText(text) {
  return String(text || "").replace(/Ã¢â‚¬Â¢|â€¢/g, " | ");
}

const UI_TRANSLATIONS = [
  [/EGI\s*ﾊｰﾈｽ\s*1/gi, "EGI HARN 1"],
  [/EGI\s*ﾊｰﾈｽ\s*2/gi, "EGI HARN 2"],
  [/ALTNTR\s*ﾊｰﾈｽ/gi, "ALTNTR HARN"],
  [/ｴﾝｼﾞﾝ\s*ﾙｰﾑ/gi, "ENGINE ROOM HARN"],
  [/ﾒｲﾝ\s*ﾊｰﾈｽ/gi, "MAIN HARN"],
  [/ﾙｰﾑﾗﾝﾌﾟ\s*&\s*ﾄﾞｱ\s*ﾊｰﾈｽ/gi, "ROOM LAMP & DOOR HARN"],
  [/ﾎﾞﾃﾞｨ\s*ﾊｰﾈｽ\s*1/gi, "BODY HARN 1"],
  [/ﾎﾞﾃﾞｨ\s*ﾊｰﾈｽ\s*2/gi, "BODY HARN 2"],
  [/ﾊﾞｯﾃﾘｰﾏﾜﾘ/gi, "BATTERY AREA"],
  [/ﾊﾟｲﾋﾟﾝｸﾞ1＆ｷｬﾆｽﾀｰ/gi, "PIPING 1 & CANISTER"],
  [/ﾊﾟｲﾋﾟﾝｸﾞ2＆ｾﾝｻｰ\(YEARA\)/gi, "PIPING 2 & SENSOR (YEAR A)"],
  [/ﾊﾟｲﾋﾟﾝｸﾞ2＆ｾﾝｻｰ/gi, "PIPING 2 & SENSOR"],
  [/パイピング1＆キャニスター/gi, "PIPING 1 & CANISTER"],
  [/パイピング2＆センサー\(YEARA\)/gi, "PIPING 2 & SENSOR (YEAR A)"],
  [/パイピング2＆センサー/gi, "PIPING 2 & SENSOR"],
  [/エンジンルーム/gi, "ENGINE ROOM HARN"],
  [/エンジン ルーム/gi, "ENGINE ROOM HARN"],
  [/ボディハーネス\s*1/gi, "BODY HARN 1"],
  [/ボディハーネス\s*2/gi, "BODY HARN 2"],
  [/メインハーネス/gi, "MAIN HARN"],
];

function translateUiText(text) {
  let value = String(text || "");
  for (const [pattern, replacement] of UI_TRANSLATIONS) {
    value = value.replace(pattern, replacement);
  }
  return value;
}

const DISPLAY_TEXT_REPLACEMENTS = [
  [/\bALTNTR HARN\b/gi, "Alternator Harness"],
  [/\bENGINE ROOM HARN\b/gi, "Engine Room Harness"],
  [/\bMAIN HARN\b/gi, "Main Harness"],
  [/\bROOM LAMP & DOOR HARN\b/gi, "Room Lamp & Door Harness"],
  [/\bBODY HARN 1\b/gi, "Body Harness 1"],
  [/\bBODY HARN 2\b/gi, "Body Harness 2"],
  [/\bBODY HARN LH\b/gi, "Body Harness Left"],
  [/\bBODY HARN RH\b/gi, "Body Harness Right"],
  [/\bEGI HARN 1\b/gi, "EGI Harness 1"],
  [/\bEGI HARN 2\b/gi, "EGI Harness 2"],
  [/\bRR SEN HARN\b/gi, "Rear Sensor Harness"],
  [/\bPIPING1&CANISTER\b/gi, "Piping 1 & Canister"],
  [/\bPIPING2&SENSOR\b/gi, "Piping 2 & Sensor"],
  [/\bINST PAD & CLUSTER LID\b/gi, "Instrument Panel & Cluster Lid"],
  [/\bE\/G MOUNT\b/gi, "Engine Mount"],
  [/\bNOMAL\b/gi, "Normal"],
  [/\bWiring\s*\(denso\)\b/gi, "Wiring"],
];

function normalizeDisplaySource(text) {
  return String(text || "")
    .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢|Ã¢â‚¬Â¢|•|·/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
}

function smartTitleCase(text) {
  return String(text || "")
    .split(/(\s+|[|/&(),-]+)/)
    .map(token => {
      if (!/[a-zA-Z]/.test(token)) return token;
      if (token === token.toUpperCase() && token.length > 1) return token;
      return token[0].toUpperCase() + token.slice(1).toLowerCase();
    })
    .join("");
}

function beautifyDisplayText(text, options = {}) {
  const { preserveCase = false } = options;
  let value = translateUiText(normalizeDisplaySource(text || ""));

  for (const [pattern, replacement] of DISPLAY_TEXT_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }

  value = value
    .replace(/\[(.*?)\]/g, "$1")
    .replace(/\s*;\s*/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s+/g, " ")
    .replace(/\|\s*\|/g, "|")
    .replace(/[|\s-]+$/g, "")
    .trim();

  return preserveCase ? value : smartTitleCase(value);
}

function splitMetaTokens(text) {
  return beautifyDisplayText(text, { preserveCase: true })
    .split("|")
    .flatMap(chunk => chunk.split(/\s*;\s*/))
    .map(chunk => chunk.trim())
    .filter(Boolean);
}

function normalizePeriod(value) {
  const match = String(value || "").match(/(\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{4}|\.\.\.)/);
  return match ? `${match[1]} - ${match[2]}` : "";
}

function looksLikeModelCode(value) {
  const text = String(value || "").trim();
  if (!text || normalizePeriod(text)) return false;
  return /^[*A-Z0-9.+()/-]+$/.test(text);
}

function isHelpfulVariantPrimary(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/[.!?]/.test(text)) return false;
  if (text.split(/\s+/).length > 6) return false;
  return text.length <= 48;
}

const MINOR_LABEL_TOKENS = new Set([
  "assy",
  "assembly",
  "set",
  "kit",
  "part",
  "parts",
]);

const GENERIC_DIAGRAM_TITLES = new Set([
  "diagram",
  "electrical",
  "electrical unit",
  "fitting",
  "harness",
  "hose",
  "layout",
  "parts",
  "piping",
  "unit",
  "wiring",
]);

function tokeniseLabel(value) {
  return normalise(value).split(/\s+/).filter(Boolean);
}

function labelsEffectivelyMatch(left, right) {
  const leftTokens = tokeniseLabel(left);
  const rightTokens = tokeniseLabel(right);
  if (!leftTokens.length || !rightTokens.length) return false;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const extras = [
    ...leftTokens.filter(token => !rightSet.has(token)),
    ...rightTokens.filter(token => !leftSet.has(token)),
  ];

  return !extras.length || extras.every(token => MINOR_LABEL_TOKENS.has(token));
}

function isGenericDiagramTitle(value) {
  const label = normalise(value);
  return !label || GENERIC_DIAGRAM_TITLES.has(label);
}

function shouldUseVariantPrimaryAsTitle(primary, fallback, systemTitle = "") {
  if (!isHelpfulVariantPrimary(primary) || !primary) return false;
  if (labelsEffectivelyMatch(primary, fallback)) return false;
  if (systemTitle && labelsEffectivelyMatch(primary, systemTitle) && !isGenericDiagramTitle(fallback)) {
    return false;
  }
  return isGenericDiagramTitle(fallback) || tokeniseLabel(fallback).length <= 1;
}

function buildVariantMeta(diagram) {
  const rawTokens = splitMetaTokens(
    diagram.pageVariantLabel
      ? `${diagram.pageVariantLabel} | ${diagram.subtitle || ""}`
      : diagram.subtitle || ""
  );

  let primary = "";
  let period = "";
  let model = "";

  for (const token of rawTokens) {
    if (!token) continue;

    const periodValue = normalizePeriod(token);
    if (!period && periodValue) {
      period = periodValue;
      continue;
    }

    const appModelMatch = token.match(/^app\.\s*model:\s*(.+)$/i);
    if (appModelMatch) {
      model = beautifyDisplayText(appModelMatch[1], { preserveCase: true });
      continue;
    }

    if (!model && looksLikeModelCode(token)) {
      model = beautifyDisplayText(token, { preserveCase: true });
      continue;
    }

    const specMatch = token.match(/^specification:\s*(.+)$/i);
    if (specMatch && !primary) {
      primary = beautifyDisplayText(specMatch[1]);
      continue;
    }

    if (!/^imported from amayama$/i.test(token) && !primary) {
      primary = beautifyDisplayText(token);
    }
  }

  return { primary, period, model };
}

function getSystemDisplayTitle(systemOrDiagram) {
  const raw = typeof systemOrDiagram === "string"
    ? systemOrDiagram
    : (systemOrDiagram?.title || systemOrDiagram?.viewFamilyTitle || "");
  return beautifyDisplayText(raw || "Untitled system");
}

function getGroupDisplayTitle(title) {
  return beautifyDisplayText(title || "Family");
}

function getDiagramDisplayTitle(diagram, systemTitle = "") {
  const fallback = beautifyDisplayText(diagram?.title || systemTitle || "Untitled diagram");
  const meta = buildVariantMeta(diagram || {});
  if (shouldUseVariantPrimaryAsTitle(meta.primary, fallback, systemTitle)) {
    return meta.primary;
  }
  return fallback;
}

function getDiagramSecondaryLabel(diagram, systemTitle = "") {
  const fallback = beautifyDisplayText(diagram?.title || systemTitle || "");
  const meta = buildVariantMeta(diagram || {});
  const bits = [];

  if (shouldUseVariantPrimaryAsTitle(meta.primary, fallback, systemTitle)) {
    bits.push(fallback);
  }

  if (meta.period) bits.push(meta.period);
  if (meta.model) bits.push(meta.model);

  return bits.join(" | ");
}

function splitDiagramSubtitle(text) {
  return beautifyDisplayText(text, { preserveCase: true })
    .split("|")
    .map(chunk => chunk.trim())
    .filter(Boolean);
}

function canonicalSystemSlug(diagram) {
  const raw = normalise(diagram.viewFamilyTitle || diagram.title || diagram.id);
  return SYSTEM_MERGE_ALIASES.get(raw) || raw || "untitled-system";
}

function canonicalSystemTitle(diagram) {
  const rawTitle = String(diagram.viewFamilyTitle || diagram.title || "Untitled system").trim();
  const alias = SYSTEM_MERGE_ALIASES.get(normalise(rawTitle));
  return getSystemDisplayTitle(alias ? titleCase(alias) : rawTitle);
}

function makeSystemId(diagram) {
  return `system-${canonicalSystemSlug(diagram)}`;
}

function getCachedApiImage(diagram) {
  const existing = String(diagram?.imagePath || "");
  if (existing.startsWith("assets/diagrams/api/")) return existing;

  const url = String(diagram?.apiImageUrl || "").trim();
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const prefix = API_IMAGE_HOST_PREFIXES.get(parsed.hostname);
    const fileName = parsed.pathname.split("/").pop();
    if (!prefix || !fileName) return "";
    const safeName = fileName.includes(".") ? fileName : `${fileName}.png`;
    return `assets/diagrams/api/${prefix}_${safeName}`;
  } catch {
    return "";
  }
}

function getPreferredImage(diagram) {
  return getCachedApiImage(diagram) || diagram?.imagePath || diagram?.apiImageUrl || "";
}

function getFallbackImage(diagram) {
  const primary = getPreferredImage(diagram);
  const candidates = [
    getCachedApiImage(diagram),
    diagram?.apiImageUrl,
    diagram?.imagePath,
  ].filter(Boolean);
  return candidates.find(candidate => candidate !== primary) || "";
}

function renderImageTag(src, altText, fallbackSrc = "", cssClass = "system-card-image") {
  if (!src) return "";
  const safeAlt = escapeHtml(altText || "");
  const fallbackAttr = fallbackSrc ? ` data-fallback-src="${escapeHtml(fallbackSrc)}"` : "";
  return `<img class="${escapeHtml(cssClass)}" src="${encodeURI(src)}" alt="${safeAlt}" loading="lazy" decoding="async" fetchpriority="low"${fallbackAttr}>`;
}

function getVariantLabel(diagram) {
  const base = beautifyDisplayText(diagram.subtitle || diagram.title || diagram.id, { preserveCase: true });
  return diagram.pageVariantLabel ? `${beautifyDisplayText(diagram.pageVariantLabel, { preserveCase: true })} | ${base}` : base;
}

function getVariantSortKey(diagram) {
  return diagram?.sortKey || getVariantLabel(diagram);
}

function getDiagramGroupTitle(diagram) {
  function normalizeFamilyName(rawText) {
    const text = beautifyDisplayText(rawText || "", { preserveCase: true });
    if (!text) return "";

    const specMatch = text.match(/specification:\s*([^;|]+)/i);
    if (specMatch) return getGroupDisplayTitle(specMatch[1].trim());

    const beforeDateMatch = text.match(/^(.+?)\s*\|\s*\d{2}\.\d{4}\s*-\s*(?:\d{2}\.\d{4}|\.\.\.)/i);
    if (beforeDateMatch) return getGroupDisplayTitle(beforeDateMatch[1].trim());

    const firstChunk = text.split("|").map(chunk => chunk.trim()).filter(Boolean)[0] || "";
    const cleaned = firstChunk
      .replace(/app\.\s*model:.*$/i, "")
      .replace(/[|\s-]+$/g, "")
      .trim();
    return getGroupDisplayTitle(cleaned);
  }

  const fromSubtitle = normalizeFamilyName(diagram?.subtitle || "");
  if (
    fromSubtitle &&
    isHelpfulVariantPrimary(fromSubtitle) &&
    !/^app\.\s*model/i.test(fromSubtitle) &&
    !/^imported from amayama/i.test(fromSubtitle)
  ) {
    return fromSubtitle;
  }

  const fromTitle = normalizeFamilyName(diagram?.title || "");
  if (fromTitle && !/^imported from amayama/i.test(fromTitle)) {
    return fromTitle;
  }

  return "Family";
}

function makeGroupId(systemId, title) {
  return `${systemId}::${normalise(title) || "group"}`;
}

function rowKey(diagramId, hotspot) {
  return `${diagramId}|${hotspot.callout || ""}|${hotspot.partNumber || ""}`;
}

function pncKey(diagramId, callout) {
  return `${diagramId}|${callout || ""}`;
}

function supplierKey(sourceName) {
  const s = String(sourceName).toLowerCase();
  if (s.includes("amayama")) return "amayama";
  if (s.includes("nissanpartsdeal")) return "npd";
  if (s.includes("yoshiparts")) return "yoshi";
  return "other";
}

function supplierLabel(sourceName) {
  const key = supplierKey(sourceName);
  if (key === "amayama") return "Amayama";
  if (key === "npd") return "NPD";
  if (key === "yoshi") return "Yoshi";
  try {
    return new URL(sourceName).hostname.replace(/^www\./, "");
  } catch {
    return sourceName;
  }
}

function outboundLink(url, label, cssClass, titleText) {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  const safeCls = escapeHtml(cssClass || "");
  const safeTitle = titleText ? ` title="${escapeHtml(titleText)}"` : "";
  return `<a href="${safeUrl}" data-href="${safeUrl}" data-outbound-link="true" class="${safeCls}"${safeTitle}>${safeLabel}</a>`;
}

function buildUrlState() {
  const params = new URLSearchParams();
  if (state.activeCategoryKey) params.set("category", state.activeCategoryKey);
  if (state.activeSystemId) params.set("system", state.activeSystemId);
  if (state.activeGroupId) params.set("group", state.activeGroupId);
  if (state.activeDiagramId) params.set("diagram", state.activeDiagramId);
  if (state.activeRowKey) params.set("row", state.activeRowKey);
  if (state.globalQuery) params.set("q", state.globalQuery);
  if (state.subsystemQuery) params.set("sub", state.subsystemQuery);
  if (state.localQuery) params.set("local", state.localQuery);
  return params.toString();
}

function applyUrlState() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);

  state.activeCategoryKey = params.get("category") || null;
  state.activeSystemId = params.get("system") || null;
  state.activeGroupId = params.get("group") || null;
  state.activeDiagramId = params.get("diagram") || null;
  state.activeRowKey = params.get("row") || null;
  state.globalQuery = params.get("q") || "";
  state.subsystemQuery = params.get("sub") || "";
  state.localQuery = params.get("local") || "";

  if (globalSearch) globalSearch.value = state.globalQuery;
  if (subsystemSearch) subsystemSearch.value = state.subsystemQuery;
  if (localSearch) localSearch.value = state.localQuery;
}

function syncUrlState() {
  const nextHash = buildUrlState();
  const currentHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (nextHash === currentHash) return;
  isRestoringUrlState = true;
  window.location.hash = nextHash;
  isRestoringUrlState = false;
}

function buildSystems() {
  return bootstrapSystems;
}

const allSystems = buildSystems();

function buildCategories(systems) {
  return bootstrapCategories;
}

const allCategories = buildCategories(allSystems);

function getActiveCategory() {
  return bootstrapCategoriesByKey.get(state.activeCategoryKey) || null;
}

function getVisibleSystems() {
  const query = normalise(state.globalQuery);
  if (!query) return allSystems;
  return allSystems.filter(system => system.searchableText.includes(query));
}

function getActiveSystem() {
  return bootstrapSystemsById.get(state.activeSystemId) || null;
}

function buildGroups(system) {
  return system?.groups || [];
}

function shouldUseGroupLanding(system) {
  return Boolean(system?.useGroupLanding);
}

function getActiveGroup(system) {
  if (!system || !shouldUseGroupLanding(system)) return null;
  return system.groupMap.get(state.activeGroupId) || null;
}

function getVisibleGroups(system) {
  if (!system) return [];
  const groups = buildGroups(system);
  const query = normalise(state.subsystemQuery);
  if (!query) return groups;

  return groups.filter(group => (group.searchableText || "").includes(query));
}

function getVisibleSubsystems(system, options = {}) {
  if (!system) return [];
  const { ignoreFilter = false } = options;
  const query = ignoreFilter ? "" : normalise(state.subsystemQuery);
  const diagrams = !shouldUseGroupLanding(system)
    ? system.diagrams
    : getGroupDiagrams(system, getActiveGroup(system));

  if (!query) return diagrams;

  return diagrams.filter(diagram => (diagram.searchableText || "").includes(query));
}

function getHotspotTargets(diagram) {
  if (diagram?._hotspotTargets) return diagram._hotspotTargets;
  const seen = new Set();
  const targets = [];

  for (const hotspot of diagram?.hotspots || []) {
    if (!hotspot.callout) continue;
    const key = `${hotspot.callout}|${hotspot.x}|${hotspot.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      callout: hotspot.callout,
      x: hotspot.x,
      y: hotspot.y,
      pncKey: pncKey(diagram.id, hotspot.callout),
      title: `${hotspot.callout} ${hotspot.partNumber || ""}`.trim(),
    });
  }

  diagram._hotspotTargets = targets;
  return targets;
}

function buildRowsForDiagram(diagram) {
  if (!diagram) return [];
  const query = normalise(state.localQuery);
  if (!diagram._rowsBase) {
    const rows = [];
    const seen = new Set();

    for (const hotspot of diagram.hotspots || []) {
      if (!hotspot.partNumber) continue;
      const key = rowKey(diagram.id, hotspot);
      if (seen.has(key)) continue;
      seen.add(key);

      const part = partsByNumber.get(hotspot.partNumber) || {
        partNumber: hotspot.partNumber,
        description: "",
        appliesDetails: "",
        period: "",
        notes: "",
      };

      const row = {
        key,
        pncKey: pncKey(diagram.id, hotspot.callout),
        diagramId: diagram.id,
        callout: hotspot.callout || "",
        partNumber: hotspot.partNumber,
        description: part.description || "",
        appliesDetails: part.appliesDetails || "",
        period: part.period || "",
        notes: part.notes || "",
        source: hotspot.source || diagram.source || "",
        variantLabel: getVariantLabel(diagram),
        links: part.links || [],
      };

      row.searchableText = normalise(
        `${row.callout} ${row.partNumber} ${row.description} ${row.appliesDetails} ${row.period} ${row.notes} ${row.source} ${row.variantLabel}`
      );
      rows.push(row);
    }

    diagram._rowsBase = rows.sort((a, b) =>
      String(a.callout).localeCompare(String(b.callout), undefined, { numeric: true }) ||
      a.partNumber.localeCompare(b.partNumber)
    );
    diagram._rowQueryCache = new Map();
  }

  if (!query) return diagram._rowsBase;
  if (diagram._rowQueryCache?.has(query)) return diagram._rowQueryCache.get(query);

  const filteredRows = diagram._rowsBase.filter(row => row.searchableText.includes(query));
  diagram._rowQueryCache.set(query, filteredRows);
  return filteredRows;
}

function resetPartsFilter() {
  state.localQuery = "";
  state.activeRowKey = null;
  if (localSearch) localSearch.value = "";
}

function selectCategory(categoryKey) {
  state.activeCategoryKey = categoryKey || null;
  state.activeSystemId = null;
  state.activeGroupId = null;
  state.activeDiagramId = null;
  state.activeRowKey = null;
  state.subsystemQuery = "";
  resetPartsFilter();
  if (subsystemSearch) subsystemSearch.value = "";
  if (isMobileViewport()) setMobileView("systems");
}

function selectRoot() {
  state.activeCategoryKey = null;
  state.activeSystemId = null;
  state.activeGroupId = null;
  state.activeDiagramId = null;
  state.activeRowKey = null;
  state.subsystemQuery = "";
  resetPartsFilter();
  if (subsystemSearch) subsystemSearch.value = "";
  if (isMobileViewport()) setMobileView("systems");
}

function selectSystem(system, options = {}) {
  if (!system) return;
  const { preserveSubsystemQuery = false } = options;
  const useGroups = shouldUseGroupLanding(system);

  state.activeCategoryKey = system.categoryKey || null;
  state.activeSystemId = system.id;
  state.activeGroupId = null;
  state.activeDiagramId = useGroups ? null : (system.diagrams[0]?.id || null);
  state.activeRowKey = null;

  if (!preserveSubsystemQuery) {
    state.subsystemQuery = "";
    if (subsystemSearch) subsystemSearch.value = "";
  }

  resetPartsFilter();

  if (isMobileViewport()) setMobileView(system.diagrams.length ? "subsystems" : "stage");
}

function selectGroup(group) {
  if (!group) return;
  state.activeGroupId = group.id;
  state.activeDiagramId = group.diagramIds?.[0] || null;
  state.activeRowKey = null;
  resetPartsFilter();
  if (isMobileViewport()) setMobileView("subsystems");
}

function clearGroupSelection() {
  state.activeGroupId = null;
  state.activeDiagramId = null;
  state.activeRowKey = null;
  resetPartsFilter();
}

function goToDiagram(diagramId) {
  if (!diagramId) return;
  state.activeDiagramId = diagramId;
  state.activeRowKey = null;
  resetPartsFilter();
  if (isMobileViewport()) setMobileView("stage");
}

function jumpDiagram(offset) {
  const system = getActiveSystem();
  if (!system) return;

  const visibleSubsystems = getVisibleSubsystems(system);
  if (!visibleSubsystems.length) return;

  const currentIndex = Math.max(visibleSubsystems.findIndex(diagram => diagram.id === state.activeDiagramId), 0);
  const nextIndex = currentIndex + offset;
  if (nextIndex < 0 || nextIndex >= visibleSubsystems.length) return;

  goToDiagram(visibleSubsystems[nextIndex].id);
  render();
}

function renderStageContext(system, activeGroup, activeDiagram, visibleSubsystems) {
  if (!stageContextBar || !stageBreadcrumbs || !stageActions) return;

  const hasSystem = Boolean(system);
  const useGroups = shouldUseGroupLanding(system);
  const activeCategory = getActiveCategory();
  const activeDiagramTitle = activeDiagram ? getDiagramDisplayTitle(activeDiagram, system?.title || "") : "";
  const visibleCount = visibleSubsystems?.length || 0;
  const activeIndex = activeDiagram ? Math.max(visibleSubsystems.findIndex(diagram => diagram.id === activeDiagram.id), 0) : -1;
  const breadcrumbParts = [
    `<button type="button" class="crumb-btn" data-nav-action="root">All systems</button>`,
  ];

  if (hasSystem) {
    if (activeCategory) {
      breadcrumbParts.push(`<span class="crumb-separator">/</span>`);
      breadcrumbParts.push(`<button type="button" class="crumb-btn" data-nav-action="category">${escapeHtml(activeCategory.title)}</button>`);
    }
    breadcrumbParts.push(`<span class="crumb-separator">/</span>`);
    breadcrumbParts.push(`<button type="button" class="crumb-btn" data-nav-action="system">${escapeHtml(getSystemDisplayTitle(system))}</button>`);
  } else if (activeCategory) {
    breadcrumbParts.push(`<span class="crumb-separator">/</span>`);
    breadcrumbParts.push(`<span class="crumb-current">${escapeHtml(activeCategory.title)}</span>`);
  }

  if (useGroups && activeGroup) {
    breadcrumbParts.push(`<span class="crumb-separator">/</span>`);
    breadcrumbParts.push(`<button type="button" class="crumb-btn" data-nav-action="groups">${escapeHtml(getGroupDisplayTitle(activeGroup.title))}</button>`);
  }

  if (activeDiagramTitle) {
    breadcrumbParts.push(`<span class="crumb-separator">/</span>`);
    breadcrumbParts.push(`<span class="crumb-current">${escapeHtml(activeDiagramTitle)}</span>`);
  }

  stageBreadcrumbs.innerHTML = breadcrumbParts.join("");

  const actions = [];
  if (!hasSystem && state.globalQuery) {
    actions.push(`<button type="button" class="context-btn" data-nav-action="clear-global-filter">Clear system search</button>`);
  }

  if (!hasSystem && activeCategory) {
    actions.push(`<button type="button" class="context-btn" data-nav-action="root">All categories</button>`);
  }

  if (hasSystem) {
    if (activeCategory) {
      actions.push(`<button type="button" class="context-btn" data-nav-action="category">Back to ${escapeHtml(activeCategory.title)}</button>`);
    } else {
      actions.push(`<button type="button" class="context-btn" data-nav-action="root">All categories</button>`);
    }
    if (useGroups && activeGroup) {
      actions.push(`<button type="button" class="context-btn" data-nav-action="groups">All families</button>`);
    }
    if (activeDiagram && visibleCount > 1) {
      actions.push(`<button type="button" class="context-btn" data-nav-action="prev-variant"${activeIndex <= 0 ? " disabled" : ""}>Prev</button>`);
      actions.push(`<button type="button" class="context-btn" data-nav-action="next-variant"${activeIndex >= visibleCount - 1 ? " disabled" : ""}>Next</button>`);
      actions.push(`<span class="context-note">Variant ${activeIndex + 1} of ${visibleCount}</span>`);
    }
  }

  if (state.subsystemQuery) {
    actions.push(`<button type="button" class="context-btn" data-nav-action="clear-subsystem-filter">Clear list filter</button>`);
  }

  if (state.localQuery) {
    actions.push(`<button type="button" class="context-btn" data-nav-action="clear-local-filter">Clear parts filter</button>`);
  }

  if (!actions.length) {
    actions.push(`<span class="context-note">Use the system search to jump in fast.</span>`);
  }

  stageActions.innerHTML = actions.join("");

  if (localSearchLabel) {
    localSearchLabel.textContent = activeDiagram
      ? "Filter parts in current diagram"
      : "Filter parts";
  }

  if (localSearch) {
    localSearch.disabled = !activeDiagram;
    localSearch.placeholder = activeDiagram
      ? "Filter by callout, part number, description, period..."
      : "Select a diagram to filter its parts...";
  }
}

function initStageImages() {
  for (const image of stageContent.querySelectorAll(".diagram-image, .system-card-image")) {
    const canvas = image.closest(".diagram-canvas");
    const card = image.closest(".system-card");
    const markReady = () => {
      image.classList.add("is-ready");
      card?.classList.remove("image-missing");
    };
    const clearLoading = () => canvas?.classList.remove("is-loading");
    const handleError = () => {
      const fallback = image.dataset.fallbackSrc || "";
      if (fallback && image.dataset.fallbackApplied !== "true") {
        image.dataset.fallbackApplied = "true";
        image.addEventListener("error", handleError, { once: true });
        image.src = encodeURI(fallback);
        return;
      }
      image.classList.add("is-ready");
      card?.classList.add("image-missing");
      clearLoading();
    };

    image.classList.remove("is-ready");
    card?.classList.remove("image-missing");

    if (image.complete && image.naturalWidth > 0) {
      markReady();
      clearLoading();
      continue;
    }

    image.addEventListener("load", () => {
      markReady();
      clearLoading();
    }, { once: true });

    image.addEventListener("error", handleError, { once: true });
  }
}

function renderSystems() {
  const visibleSystems = getVisibleSystems();
  const activeCategory = getActiveCategory();
  systemList.innerHTML = "";

  if (systemPanelKicker) {
    systemPanelKicker.textContent = state.globalQuery ? "Search Results" : (activeCategory ? "Systems" : "Categories");
  }

  if (systemPanelTitle) {
    systemPanelTitle.textContent = state.globalQuery
      ? "Matching systems"
      : (activeCategory ? activeCategory.title : "Browse by category");
  }

  if (!state.globalQuery && !activeCategory) {
    systemCount.textContent = `${allCategories.length}`;

    for (const category of allCategories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "system-item";
      if (category.key === state.activeCategoryKey) button.classList.add("active");
      button.innerHTML = `
        <strong>${escapeHtml(category.title)}</strong>
        <span>${category.systemCount} systems | ${category.partCount} indexed parts</span>
      `;
      button.addEventListener("click", () => {
        selectCategory(category.key);
        render();
      });
      systemList.appendChild(button);
    }
    return;
  }

  const systemsToRender = state.globalQuery
    ? visibleSystems
    : (activeCategory?.systems || []);

  systemCount.textContent = `${systemsToRender.length}`;

  if (!state.globalQuery && activeCategory) {
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "system-item";
    backButton.innerHTML = `
      <strong>All categories</strong>
      <span>Back to the main grouped view</span>
    `;
    backButton.addEventListener("click", () => {
      selectRoot();
      render();
    });
    systemList.appendChild(backButton);
  }

  for (const system of systemsToRender) {
    const useGroups = shouldUseGroupLanding(system);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "system-item";
    if (system.id === state.activeSystemId) button.classList.add("active");
    button.innerHTML = `
      <strong>${escapeHtml(getSystemDisplayTitle(system))}</strong>
      <span>${system.diagrams.length} ${useGroups ? "variants" : "diagrams"} | ${system.partCount} indexed parts</span>
    `;
    button.addEventListener("click", () => {
      selectSystem(system);
      render();
    });
    systemList.appendChild(button);
  }

  if (!systemsToRender.length) {
    systemList.innerHTML += `
      <div class="empty-state">
        <h3>No systems matched</h3>
        <p>Try a broader search or go back to categories.</p>
      </div>
    `;
  }
}

function renderGroupLanding(system) {
  const groups = getVisibleGroups(system);
  stageTitle.textContent = getSystemDisplayTitle(system);
  stageNote.textContent = state.subsystemQuery
    ? "Filtered family view. Clear the list filter to see every family in this system."
    : "Select a family to open its variants, diagrams, and linked parts.";
  matchCount.textContent = `${system.partCount} indexed parts`;

  renderStageContext(system, null, null, []);

  if (!groups.length) {
    stageContent.innerHTML = `
      <div class="empty-state">
        <h3>No families matched</h3>
        <p>Try a broader list filter or clear it to show every family in this system.</p>
      </div>
    `;
    return;
  }

  stageContent.innerHTML = `
    <div class="system-grid">
      ${groups.map(group => `
        <article class="system-card" data-group-id="${escapeHtml(group.id)}" role="button" tabindex="0">
          ${group.previewImage ? `
            <div class="system-card-gallery single">
              ${renderImageTag(group.previewImage, `${group.title} preview`, group.previewFallbackImage)}
            </div>
          ` : ""}
          <h3>${escapeHtml(getGroupDisplayTitle(group.title))}</h3>
          <p>${group.diagramIds.length} variants | ${group.partCount} indexed parts</p>
        </article>
      `).join("")}
    </div>
  `;

  initStageImages();
}

function renderSubsystems(system) {
  subsystemList.innerHTML = "";
  const useGroups = shouldUseGroupLanding(system);
  const activeGroup = getActiveGroup(system);
  const groups = useGroups ? getVisibleGroups(system) : [];
  const subsystems = getVisibleSubsystems(system);

  subsystemTitle.textContent = system
    ? (useGroups ? (activeGroup ? getGroupDisplayTitle(activeGroup.title) : "Families") : getSystemDisplayTitle(system))
    : "Choose a system";
  subsystemCount.textContent = `${useGroups ? (activeGroup ? subsystems.length : groups.length) : subsystems.length}`;

  if (subsystemSearch) {
    subsystemSearch.disabled = !system;
    subsystemSearch.placeholder = !system
      ? "Select a system to filter families or diagrams..."
      : (useGroups && !activeGroup
        ? "Filter families in this system..."
        : "Filter diagrams in this selection...");
  }

  if (!system) {
    subsystemList.innerHTML = `
      <div class="empty-state">
        <h3>Subcategories will appear here</h3>
        <p>Select a system from the list above.</p>
      </div>
    `;
    return;
  }

  if (useGroups && !activeGroup) {
    if (!groups.length) {
      subsystemList.innerHTML = `
        <div class="empty-state">
          <h3>No families matched</h3>
          <p>Try a broader list filter or clear it to see every family.</p>
        </div>
      `;
      return;
    }

    for (const group of groups) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "subsystem-item";
      button.innerHTML = `
        <strong>${escapeHtml(getGroupDisplayTitle(group.title))}</strong>
        <span>${group.diagramIds.length} variants | ${group.partCount} indexed parts</span>
      `;
      button.addEventListener("click", () => {
        selectGroup(group);
        render();
      });
      subsystemList.appendChild(button);
    }
    return;
  }

  if (useGroups && activeGroup) {
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "subsystem-item";
    backButton.innerHTML = `
      <strong>All families</strong>
      <span>Back to the family explorer</span>
    `;
    backButton.addEventListener("click", () => {
      clearGroupSelection();
      render();
    });
    subsystemList.appendChild(backButton);
  }

  if (!subsystems.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h3>No diagrams matched</h3>
      <p>Adjust the list filter to bring variants back into view.</p>
    `;
    subsystemList.appendChild(empty);
    return;
  }

  for (const diagram of subsystems) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "subsystem-item";
    if (diagram.id === state.activeDiagramId) button.classList.add("active");
    const displayName = getDiagramDisplayTitle(diagram, system.title);
    const secondary = getDiagramSecondaryLabel(diagram, system.title) || "Open diagram and linked parts";
    button.innerHTML = `
      <strong>${escapeHtml(displayName)}</strong>
      <span>${escapeHtml(secondary)}</span>
    `;
    button.addEventListener("click", () => {
      goToDiagram(diagram.id);
      render();
    });
    subsystemList.appendChild(button);
  }
}

function renderPartDetailCard(row) {
  const part = partsByNumber.get(row.partNumber);
  if (!part) return "";

  const relatedParts = (part.relatedPartNumbers || [])
    .map(pn => partsByNumber.get(pn))
    .filter(Boolean);

  const allVariants = [part, ...relatedParts.filter(p => p.partNumber !== part.partNumber)]
    .sort((a, b) => (a.period || "").localeCompare(b.period || ""));

  const variantRowsHtml = allVariants.map(v => {
    const isCurrent = v.partNumber === row.partNumber;
    const vLinks = (v.links || []).map(link =>
      outboundLink(link.url, supplierLabel(link.sourceName),
        `supplier-btn supplier-btn--${supplierKey(link.sourceName)}`, link.url)
    ).join("");
    return `
      <tr class="${isCurrent ? "variant-row-current" : ""}">
        <td>${escapeHtml(v.period || "-")}</td>
        <td>
          ${v.links?.[0]?.url ? outboundLink(v.links[0].url, v.partNumber, "pn-link") : escapeHtml(v.partNumber)}
          ${isCurrent ? `<span class="variant-current-badge">selected</span>` : ""}
        </td>
        <td>${escapeHtml(v.description || part.description || "-")}</td>
        <td>${escapeHtml(v.appliesDetails || "-")}</td>
        <td class="col-buy">${vLinks}</td>
      </tr>`;
  }).join("");

  const headBtns = (part.links || []).map(link =>
    outboundLink(link.url, supplierLabel(link.sourceName), `supplier-btn supplier-btn--${supplierKey(link.sourceName)}`)
  ).join("");

  return `
    <div class="part-detail-card">
      <div class="part-detail-card-head">
        <span class="detail-pn">${escapeHtml(part.partNumber)}</span>
        <span class="detail-desc">${escapeHtml(part.description || "")}</span>
        ${part.priceAed ? `<span class="detail-price">AED&nbsp;${escapeHtml(part.priceAed)}</span>` : ""}
        <span class="detail-head-links">${headBtns}</span>
      </div>
      ${allVariants.length > 1 ? `
        <p class="detail-variants-label">${allVariants.length} known variants for this part series | by production period</p>
        <div class="variants-table-wrap">
          <table class="variants-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Part Number</th>
                <th>Description</th>
                <th>Applies To</th>
                <th>Buy</th>
              </tr>
            </thead>
            <tbody>${variantRowsHtml}</tbody>
          </table>
        </div>
      ` : `<p class="detail-note">No other variants recorded for this part number series.</p>`}
    </div>`;
}

function clearStageHover() {
  for (const el of stageContent.querySelectorAll(".hovered")) el.classList.remove("hovered");
}

function applyStageHover(pncKeyValue) {
  clearStageHover();
  if (!pncKeyValue) return;
  for (const el of stageContent.querySelectorAll(`[data-pnc-key="${CSS.escape(pncKeyValue)}"]`)) {
    el.classList.add("hovered");
  }
}

function syncMobileHotspotToggle() {
  const figure = stageContent.querySelector(".diagram-figure");
  if (figure) {
    figure.classList.toggle("show-mobile-hotspots", Boolean(isMobileViewport() && state.mobileHotspotsVisible));
  }

  const toggle = stageContent.querySelector("[data-toggle-mobile-hotspots='true']");
  if (!toggle) return;
  const pressed = Boolean(isMobileViewport() && state.mobileHotspotsVisible);
  toggle.setAttribute("aria-pressed", pressed ? "true" : "false");
  toggle.textContent = pressed ? "Hide callouts" : "Show callouts";
}

function syncStageSelection(options = {}) {
  const { scrollExpansion = false } = options;
  if (!currentStageSelection || currentStageSelection.diagramId !== state.activeDiagramId) return;

  const activeRow = currentStageSelection.diagramRows.find(row => row.key === state.activeRowKey) || null;
  const activePncKey = activeRow?.pncKey || "";

  for (const rowEl of stageContent.querySelectorAll("tbody tr[data-row-key]")) {
    rowEl.classList.toggle("active", rowEl.dataset.rowKey === state.activeRowKey);
  }

  for (const hotspotEl of stageContent.querySelectorAll(".hotspot")) {
    hotspotEl.classList.toggle("active", hotspotEl.dataset.pncKey === activePncKey);
  }

  const existingExpansion = stageContent.querySelector(".expansion-row");
  existingExpansion?.remove();

  if (activeRow) {
    const activeRowElement = stageContent.querySelector(`tbody tr[data-row-key="${CSS.escape(activeRow.key)}"]`);
    if (activeRowElement) {
      activeRowElement.insertAdjacentHTML(
        "afterend",
        `<tr class="expansion-row"><td colspan="7">${renderPartDetailCard(activeRow)}</td></tr>`
      );
      if (scrollExpansion) {
        const expansion = stageContent.querySelector(".expansion-row");
        expansion?.scrollIntoView({ behavior: getMotionBehavior(), block: "nearest" });
      }
    }
  }

  syncMobileHotspotToggle();
  syncUrlState();
}

function renderDiagramRows(system) {
  if (!system) {
    const visibleSystems = getVisibleSystems();
    const activeCategory = getActiveCategory();

    if (state.globalQuery) {
      stageTitle.textContent = "Matching systems";
      stageNote.textContent = "Filtered systems view. Select a result to jump straight into its diagrams and linked parts.";
      matchCount.textContent = `${visibleSystems.reduce((sum, item) => sum + item.partCount, 0)} indexed parts`;
    } else if (activeCategory) {
      stageTitle.textContent = activeCategory.title;
      stageNote.textContent = activeCategory.description;
      matchCount.textContent = `${activeCategory.partCount} indexed parts`;
    } else {
      stageTitle.textContent = "All categories";
      stageNote.textContent = "Start with a high-level area, then drill into the exact system and diagram you need.";
      matchCount.textContent = `${allCategories.reduce((sum, item) => sum + item.partCount, 0)} indexed parts`;
    }

    renderStageContext(null, null, null, []);

    const rootCards = state.globalQuery
      ? visibleSystems.map(item => ({
          key: item.id,
          title: getSystemDisplayTitle(item),
          subtitle: `${item.diagrams.length} diagrams | ${item.partCount} indexed parts`,
          previewImage: item.previewImage,
          previewFallbackImage: item.previewFallbackImage,
          datasetName: "systemId",
        }))
      : activeCategory
        ? activeCategory.systems.map(item => ({
            key: item.id,
            title: getSystemDisplayTitle(item),
            subtitle: `${item.diagrams.length} diagrams | ${item.partCount} indexed parts`,
            previewImage: item.previewImage,
            previewFallbackImage: item.previewFallbackImage,
            datasetName: "systemId",
          }))
        : allCategories.map(category => ({
            key: category.key,
            title: category.title,
            subtitle: `${category.systemCount} systems | ${category.partCount} indexed parts`,
            previewImage: category.previewImage,
            previewFallbackImage: category.previewFallbackImage,
            datasetName: "categoryKey",
          }));

    if (!rootCards.length) {
      stageContent.innerHTML = `
        <div class="empty-state">
          <h3>${state.globalQuery ? "No systems matched" : "No categories available"}</h3>
          <p>${state.globalQuery ? "Try a broader system search to bring matching categories back." : "The grouped catalog view is empty right now."}</p>
        </div>
      `;
      return;
    }

    stageContent.innerHTML = `
      <div class="system-grid">
        ${rootCards.map(card => `
          <article class="system-card" data-${card.datasetName === "categoryKey" ? "category-key" : "system-id"}="${escapeHtml(card.key)}" role="button" tabindex="0">
            ${card.previewImage ? `
              <div class="system-card-gallery single">
                ${renderImageTag(card.previewImage, `${card.title} preview`, card.previewFallbackImage)}
              </div>
            ` : ""}
            <h3>${escapeHtml(card.title)}</h3>
            <p>${escapeHtml(card.subtitle)}</p>
          </article>
        `).join("")}
      </div>
    `;

    initStageImages();

    return;
  }

  const useGroups = shouldUseGroupLanding(system);
  const activeGroup = getActiveGroup(system);
  const visibleSubsystems = getVisibleSubsystems(system);

  if (useGroups && !activeGroup) {
    renderGroupLanding(system);
    return;
  }

  const activeDiagram = visibleSubsystems.find(diagram => diagram.id === state.activeDiagramId) || visibleSubsystems[0];
  stageTitle.textContent = getSystemDisplayTitle(system);

  if (!activeDiagram) {
    stageNote.textContent = "No diagrams matched the current list filter.";
    matchCount.textContent = `${system.partCount} indexed parts`;
    renderStageContext(system, activeGroup, null, visibleSubsystems);
    stageContent.innerHTML = `
      <div class="empty-state">
        <h3>No diagrams matched</h3>
        <p>Clear the list filter or choose a different family to keep moving.</p>
      </div>
    `;
    return;
  }

  if (!system.isLoaded) {
    stageNote.textContent = system.loadError
      ? "The selected system could not be loaded."
      : "Loading the selected system's diagrams and part records.";
    matchCount.textContent = `${system.partCount} indexed parts`;
    renderStageContext(system, activeGroup, activeDiagram, visibleSubsystems);
    stageContent.innerHTML = `
      <div class="loading-panel${system.loadError ? " is-error" : ""}">
        <h3>${system.loadError ? "Could not load this system" : "Preparing diagram data"}</h3>
        <p>${system.loadError || "Pulling in only the active system so startup stays light."}</p>
      </div>
    `;
    if (!system.loadError) requestSystemLoad(system.id);
    return;
  }

  const diagramRows = buildRowsForDiagram(activeDiagram);
  const visiblePncKeys = new Set(diagramRows.map(row => row.pncKey));
  const hotspotTargets = getHotspotTargets(activeDiagram);
  const activeRow = diagramRows.find(row => row.key === state.activeRowKey) || null;
  const activePncKey = activeRow?.pncKey || "";
  const mobileHotspotsVisible = isMobileViewport() && state.mobileHotspotsVisible;

  stageNote.textContent = useGroups
    ? `${getGroupDisplayTitle(activeGroup?.title || "Family")} | ${visibleSubsystems.length} variants`
    : `${visibleSubsystems.length} diagrams in this system`;
  matchCount.textContent = `${system.partCount} indexed parts`;
  renderStageContext(system, activeGroup, activeDiagram, visibleSubsystems);

  stageContent.innerHTML = `
    <div class="diagram-stack">
      <section class="diagram-row" id="diagram-row-${escapeHtml(activeDiagram.id)}">
        <article class="diagram-card">
          <div class="diagram-card-header">
            <div>
              <h3>${escapeHtml(getDiagramDisplayTitle(activeDiagram, system.title))}</h3>
              <div class="diagram-meta">${escapeHtml(getDiagramSecondaryLabel(activeDiagram, system.title) || "Linked parts and callouts")}</div>
            </div>
            ${isMobileViewport() ? `
              <button
                type="button"
                class="diagram-toggle-btn"
                data-toggle-mobile-hotspots="true"
                aria-pressed="${mobileHotspotsVisible ? "true" : "false"}"
              >${mobileHotspotsVisible ? "Hide callouts" : "Show callouts"}</button>
            ` : ""}
          </div>
          <div class="diagram-canvas is-loading">
            <div class="diagram-loading">Loading diagram...</div>
            <div class="diagram-figure${mobileHotspotsVisible ? " show-mobile-hotspots" : ""}">
              <img
                class="diagram-image"
                src="${encodeURI(getPreferredImage(activeDiagram))}"
                ${getFallbackImage(activeDiagram) ? `data-fallback-src="${escapeHtml(getFallbackImage(activeDiagram))}"` : ""}
                alt="${escapeHtml(activeDiagram.title || system.title)}"
                decoding="async"
                fetchpriority="high"
              >
              ${hotspotTargets.map(target => `
                <button
                  class="hotspot${target.pncKey === activePncKey ? " active" : ""}${visiblePncKeys.has(target.pncKey) ? "" : " dimmed"}"
                  style="left:${target.x}%; top:${target.y}%"
                  data-pnc-key="${escapeHtml(target.pncKey)}"
                  data-diagram-id="${escapeHtml(activeDiagram.id)}"
                  data-callout="${escapeHtml(target.callout)}"
                  type="button"
                  title="${escapeHtml(target.title)}"
                  aria-label="${escapeHtml(target.title)}"
                ><span>${escapeHtml(target.callout)}</span></button>
              `).join("")}
            </div>
          </div>
        </article>
        <section class="diagram-parts-window">
          <div class="diagram-parts-head">
            <div>
              <p class="panel-kicker">Parts Window</p>
              <h3>${escapeHtml(getDiagramDisplayTitle(activeDiagram, system.title))}</h3>
              <p class="panel-note">${escapeHtml(getDiagramSecondaryLabel(activeDiagram, system.title) || "Linked OEM part records")}</p>
            </div>
            <span class="meta-pill">${diagramRows.length}</span>
          </div>
          <div class="diagram-parts-table-wrap">
            ${diagramRows.length ? `
              <table class="parts-table">
                <thead>
                  <tr>
                    <th class="col-ref">Ref</th>
                    <th class="col-oem">OEM</th>
                    <th class="col-desc">Description</th>
                    <th class="col-applies">Applies / Details</th>
                    <th class="col-period">Period</th>
                    <th class="col-notes">Notes</th>
                    <th class="col-buy">Buy</th>
                  </tr>
                </thead>
                <tbody>
                  ${diagramRows.map(row => {
                    const primaryUrl = row.links[0]?.url || "";
                    const isActive = row.key === state.activeRowKey;
                    const supplierBtns = row.links.map(link =>
                      outboundLink(link.url, supplierLabel(link.sourceName),
                        `supplier-btn supplier-btn--${supplierKey(link.sourceName)}`, link.url)
                    ).join("");
                    return `
                    <tr
                      data-row-key="${escapeHtml(row.key)}"
                      data-pnc-key="${escapeHtml(row.pncKey)}"
                      data-diagram-id="${escapeHtml(row.diagramId)}"
                      class="${isActive ? "active" : ""}"
                      title="Click to inspect this part and highlight its callout"
                      tabindex="0"
                    >
                      <td class="col-ref"><span class="callout-badge">${escapeHtml(row.callout || "-")}</span></td>
                      <td class="col-oem">${primaryUrl ? outboundLink(primaryUrl, row.partNumber, "pn-link") : escapeHtml(row.partNumber)}</td>
                      <td>${escapeHtml(row.description || "")}</td>
                      <td>${escapeHtml(row.appliesDetails || "")}</td>
                      <td>${escapeHtml(row.period || "")}</td>
                      <td>${escapeHtml(row.notes || "")}</td>
                      <td class="col-buy">${supplierBtns}</td>
                    </tr>
                    ${isActive ? `
                    <tr class="expansion-row">
                      <td colspan="7">${renderPartDetailCard(row)}</td>
                    </tr>` : ""}
                    `;
                  }).join("")}
                </tbody>
              </table>
            ` : `
              <div class="empty-state">
                <h3>No parts to display</h3>
                <p>Broaden the current section search to bring matching rows back.</p>
              </div>
            `}
          </div>
        </section>
      </section>
    </div>
  `;
  currentStageSelection = {
    diagramId: activeDiagram.id,
    diagramRows,
  };
  syncMobileHotspotToggle();
  initStageImages();
}

function render() {
  syncMobileView();
  const visibleSystems = getVisibleSystems();

  if (state.activeSystemId && !visibleSystems.some(system => system.id === state.activeSystemId)) {
    state.activeSystemId = null;
    state.activeGroupId = null;
    state.activeDiagramId = null;
    state.activeRowKey = null;
  }

  const system = getActiveSystem();
  if (system) {
    state.activeCategoryKey = system.categoryKey || null;
  } else if (state.activeCategoryKey && !allCategories.some(category => category.key === state.activeCategoryKey)) {
    state.activeCategoryKey = null;
  }

  const useGroups = shouldUseGroupLanding(system);

  if (useGroups) {
    const group = getActiveGroup(system);
    state.activeGroupId = group?.id || null;

    const visibleGroupDiagrams = getVisibleSubsystems(system);

    if (group && !visibleGroupDiagrams.some(diagram => diagram.id === state.activeDiagramId)) {
      state.activeDiagramId = visibleGroupDiagrams[0]?.id || null;
      state.activeRowKey = null;
    }

    if (!group) {
      state.activeDiagramId = null;
      state.activeRowKey = null;
    }
  } else {
    state.activeGroupId = null;
    const visibleDiagrams = getVisibleSubsystems(system);
    if (system && !visibleDiagrams.some(diagram => diagram.id === state.activeDiagramId)) {
      state.activeDiagramId = visibleDiagrams[0]?.id || null;
      state.activeRowKey = null;
    }
  }

  if (system) {
    const activeDiagram = getVisibleSubsystems(system).find(diagram => diagram.id === state.activeDiagramId);
    if (activeDiagram && system.isLoaded) {
      const visibleRows = buildRowsForDiagram(activeDiagram);
      if (state.activeRowKey && !visibleRows.some(row => row.key === state.activeRowKey)) {
        state.activeRowKey = null;
      }
    }
  }

  renderSystems();
  renderSubsystems(system);
  currentStageSelection = null;
  renderDiagramRows(system);
  renderMobileNav();
  syncUrlState();
}

function activateSystemCard(card) {
  if (!card) return;

  if (card.dataset.categoryKey) {
    selectCategory(card.dataset.categoryKey);
    render();
    return;
  }

  if (card.dataset.systemId) {
    const nextSystem = bootstrapSystemsById.get(card.dataset.systemId);
    if (!nextSystem) return;
    selectSystem(nextSystem);
    render();
    return;
  }

  if (card.dataset.groupId) {
    const system = getActiveSystem();
    const group = system?.groupMap.get(card.dataset.groupId);
    if (!group) return;
    selectGroup(group);
    render();
  }
}

function activateStageRow(rowKey, diagramId, options = {}) {
  if (!rowKey || !currentStageSelection) return;
  const { scrollExpansion = false } = options;
  state.activeDiagramId = diagramId || state.activeDiagramId;
  state.activeRowKey = state.activeRowKey === rowKey ? null : rowKey;
  if (isMobileViewport()) setMobileView("stage");
  syncStageSelection({ scrollExpansion: scrollExpansion && Boolean(state.activeRowKey) });
}

function activateHotspot(pncKeyValue, diagramId) {
  if (!pncKeyValue || !currentStageSelection) return;
  const nextRow = currentStageSelection.diagramRows.find(row => row.pncKey === pncKeyValue) || null;
  state.activeDiagramId = diagramId || state.activeDiagramId;
  state.activeRowKey = nextRow?.key || null;
  if (isMobileViewport()) setMobileView("stage");
  syncStageSelection({ scrollExpansion: Boolean(nextRow) });
}

let globalSearchDebounce = 0;
let subsystemSearchDebounce = 0;
let localSearchDebounce = 0;

globalSearch.addEventListener("input", event => {
  const value = event.target.value || "";
  clearTimeout(globalSearchDebounce);
  globalSearchDebounce = setTimeout(() => {
    state.globalQuery = value;
    render();
  }, 180);
});

subsystemSearch?.addEventListener("input", event => {
  const value = event.target.value || "";
  clearTimeout(subsystemSearchDebounce);
  subsystemSearchDebounce = setTimeout(() => {
    state.subsystemQuery = value;
    state.activeRowKey = null;
    render();
  }, 140);
});

localSearch.addEventListener("input", event => {
  const value = event.target.value || "";
  clearTimeout(localSearchDebounce);
  localSearchDebounce = setTimeout(() => {
    state.localQuery = value;
    state.activeRowKey = null;
    render();
  }, 180);
});

for (const button of mobileNavButtons) {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    setMobileView(button.dataset.mobileView || "systems");
    renderMobileNav();
  });
}

document.addEventListener("click", event => {
  const link = event.target.closest("a[data-outbound-link='true']");
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  window.open(link.dataset.href, "_blank", "noopener,noreferrer");
});

stageContent?.addEventListener("click", event => {
  if (event.target.closest("a[data-outbound-link='true']")) return;

  const toggle = event.target.closest("[data-toggle-mobile-hotspots='true']");
  if (toggle) {
    state.mobileHotspotsVisible = !state.mobileHotspotsVisible;
    syncMobileHotspotToggle();
    return;
  }

  const row = event.target.closest("tbody tr[data-row-key]");
  if (row && currentStageSelection?.diagramId === row.dataset.diagramId) {
    activateStageRow(row.dataset.rowKey || "", row.dataset.diagramId || "", { scrollExpansion: true });
    return;
  }

  const hotspot = event.target.closest(".hotspot");
  if (hotspot && currentStageSelection?.diagramId === hotspot.dataset.diagramId) {
    activateHotspot(hotspot.dataset.pncKey || "", hotspot.dataset.diagramId || "");
    return;
  }

  const card = event.target.closest(".system-card");
  if (card && stageContent.contains(card)) {
    activateSystemCard(card);
  }
});

stageContent?.addEventListener("keydown", event => {
  if (event.defaultPrevented) return;
  if (event.key !== "Enter" && event.key !== " ") return;

  const row = event.target.closest("tbody tr[data-row-key]");
  if (row && currentStageSelection?.diagramId === row.dataset.diagramId) {
    event.preventDefault();
    activateStageRow(row.dataset.rowKey || "", row.dataset.diagramId || "", { scrollExpansion: true });
    return;
  }

  const card = event.target.closest(".system-card");
  if (card && stageContent.contains(card)) {
    event.preventDefault();
    activateSystemCard(card);
  }
});

stageContent?.addEventListener("mouseover", event => {
  const target = event.target.closest("[data-pnc-key]");
  if (!target || !stageContent.contains(target)) return;
  applyStageHover(target.dataset.pncKey || "");
});

stageContent?.addEventListener("mouseout", event => {
  const target = event.target.closest("[data-pnc-key]");
  if (!target || !stageContent.contains(target)) return;
  const nextTarget = event.relatedTarget?.closest?.("[data-pnc-key]");
  if (nextTarget && stageContent.contains(nextTarget)) {
    if ((nextTarget.dataset.pncKey || "") === (target.dataset.pncKey || "")) return;
    applyStageHover(nextTarget.dataset.pncKey || "");
    return;
  }
  clearStageHover();
});

stageContextBar?.addEventListener("click", event => {
  const trigger = event.target.closest("[data-nav-action]");
  if (!trigger || trigger.hasAttribute("disabled")) return;

  const action = trigger.dataset.navAction;
  const system = getActiveSystem();

  if (action === "root") {
    selectRoot();
    render();
    return;
  }

  if (action === "clear-global-filter") {
    state.globalQuery = "";
    if (globalSearch) globalSearch.value = "";
    render();
    return;
  }

  if (action === "category") {
    if (state.activeCategoryKey) {
      selectCategory(state.activeCategoryKey);
      render();
    }
    return;
  }

  if (!system) return;

  if (action === "system") {
    selectSystem(system, { preserveSubsystemQuery: true });
    render();
    return;
  }

  if (action === "groups") {
    clearGroupSelection();
    if (isMobileViewport()) setMobileView("subsystems");
    render();
    return;
  }

  if (action === "prev-variant") {
    jumpDiagram(-1);
    return;
  }

  if (action === "next-variant") {
    jumpDiagram(1);
    return;
  }

  if (action === "clear-subsystem-filter") {
    state.subsystemQuery = "";
    if (subsystemSearch) subsystemSearch.value = "";
    render();
    return;
  }

  if (action === "clear-local-filter") {
    resetPartsFilter();
    render();
  }
});

function isTypingTarget(target) {
  if (!target) return false;
  const tagName = target.tagName || "";
  return tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable;
}

window.addEventListener("keydown", event => {
  if (event.defaultPrevented || isTypingTarget(event.target)) return;

  if (event.key === "/") {
    event.preventDefault();
    if (localSearch && !localSearch.disabled) {
      localSearch.focus();
      localSearch.select();
    } else if (subsystemSearch && !subsystemSearch.disabled) {
      subsystemSearch.focus();
      subsystemSearch.select();
    } else if (globalSearch) {
      globalSearch.focus();
      globalSearch.select();
    }
    return;
  }

  if (event.key === "[") {
    event.preventDefault();
    jumpDiagram(-1);
    return;
  }

  if (event.key === "]") {
    event.preventDefault();
    jumpDiagram(1);
  }
});

window.addEventListener("resize", () => {
  syncMobileView();
  renderMobileNav();
  syncMobileHotspotToggle();
});

window.addEventListener("hashchange", () => {
  if (isRestoringUrlState) return;
  applyUrlState();
  render();
});

applyUrlState();
render();

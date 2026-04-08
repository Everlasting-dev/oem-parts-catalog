const catalog = window.CATALOG_DATA || { parts: [], diagrams: [] };

const state = {
  globalQuery: "",
  localQuery: "",
  activeSystemId: null,
  activeGroupId: null,
  activeDiagramId: null,
  activeRowKey: null,
  mobileView: "systems",
};

const partsByNumber = new Map((catalog.parts || []).map(part => [part.partNumber, part]));

const SYSTEM_MERGE_ALIASES = new Map([
  ["alternator fitting", "alternator"],
  ["anti skid control chassis", "anti skid control"],
  ["wiring denso", "wiring"],
  ["manifold engine", "manifold"],
  ["floor panel rear", "floor panel"],
]);

const globalSearch = document.getElementById("global-search");
const localSearch = document.getElementById("local-search");
const catalogShell = document.querySelector(".catalog-shell");
const mobileNavButtons = [...document.querySelectorAll(".mobile-nav-btn")];
const systemCount = document.getElementById("system-count");
const subsystemCount = document.getElementById("subsystem-count");
const systemList = document.getElementById("system-list");
const subsystemTitle = document.getElementById("subsystem-title");
const subsystemList = document.getElementById("subsystem-list");
const stageTitle = document.getElementById("stage-title");
const stageNote = document.getElementById("stage-note");
const matchCount = document.getElementById("match-count");
const stageContent = document.getElementById("stage-content");
let isRestoringUrlState = false;

function isMobileViewport() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function setMobileView(view) {
  state.mobileView = view;
  if (catalogShell) catalogShell.dataset.mobileView = view;
}

function syncMobileView() {
  if (!isMobileViewport()) {
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

function splitDiagramSubtitle(text) {
  return cleanBulletText(text)
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
  return translateUiText(alias ? titleCase(alias) : rawTitle);
}

function makeSystemId(diagram) {
  return `system-${canonicalSystemSlug(diagram)}`;
}

function getPreferredImage(diagram) {
  return diagram?.apiImageUrl || diagram?.imagePath || "";
}

function getVariantLabel(diagram) {
  const base = translateUiText(cleanBulletText(diagram.subtitle || diagram.title || diagram.id));
  return diagram.pageVariantLabel ? `${translateUiText(diagram.pageVariantLabel)} | ${base}` : base;
}

function getVariantSortKey(diagram) {
  return diagram?.sortKey || getVariantLabel(diagram);
}

function getDiagramGroupTitle(diagram) {
  function normalizeFamilyName(rawText) {
    const text = translateUiText(cleanBulletText(rawText || ""));
    if (!text) return "";

    const specMatch = text.match(/specification:\s*([^;|]+)/i);
    if (specMatch) return specMatch[1].trim();

    const beforeDateMatch = text.match(/^(.+?)\s*\|\s*\d{2}\.\d{4}\s*-\s*(?:\d{2}\.\d{4}|\.\.\.)/i);
    if (beforeDateMatch) return beforeDateMatch[1].trim();

    const firstChunk = text.split("|").map(chunk => chunk.trim()).filter(Boolean)[0] || "";
    const cleaned = firstChunk
      .replace(/app\.\s*model:.*$/i, "")
      .replace(/\[[^\]]+\]$/g, "")
      .replace(/[|\s-]+$/g, "")
      .trim();
    return cleaned;
  }

  const fromSubtitle = normalizeFamilyName(diagram?.subtitle || "");
  if (fromSubtitle && !/^app\.\s*model/i.test(fromSubtitle) && !/^imported from amayama/i.test(fromSubtitle)) {
    return fromSubtitle;
  }

  const fromTitle = normalizeFamilyName(diagram?.title || "");
  if (fromTitle && !/^imported from amayama/i.test(fromTitle)) {
    return fromTitle;
  }

  return "Variant";
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
  return `<a href="${safeUrl}" data-href="${safeUrl}" class="${safeCls}"${safeTitle} onclick="event.preventDefault();event.stopPropagation();window.open(this.dataset.href,'_blank','noopener,noreferrer')">${safeLabel}</a>`;
}

function buildUrlState() {
  const params = new URLSearchParams();
  if (state.activeSystemId) params.set("system", state.activeSystemId);
  if (state.activeGroupId) params.set("group", state.activeGroupId);
  if (state.activeDiagramId) params.set("diagram", state.activeDiagramId);
  if (state.activeRowKey) params.set("row", state.activeRowKey);
  if (state.globalQuery) params.set("q", state.globalQuery);
  if (state.localQuery) params.set("local", state.localQuery);
  return params.toString();
}

function applyUrlState() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);

  state.activeSystemId = params.get("system") || null;
  state.activeGroupId = params.get("group") || null;
  state.activeDiagramId = params.get("diagram") || null;
  state.activeRowKey = params.get("row") || null;
  state.globalQuery = params.get("q") || "";
  state.localQuery = params.get("local") || "";

  if (globalSearch) globalSearch.value = state.globalQuery;
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
  const systems = new Map();

  for (const diagram of catalog.diagrams || []) {
    const systemId = makeSystemId(diagram);
    if (!systems.has(systemId)) {
      systems.set(systemId, {
        id: systemId,
        title: canonicalSystemTitle(diagram),
        diagrams: [],
        partNumbers: new Set(),
      });
    }

    const system = systems.get(systemId);
    system.diagrams.push(diagram);
    for (const hotspot of diagram.hotspots || []) {
      if (hotspot.partNumber) system.partNumbers.add(hotspot.partNumber);
    }
  }

  return [...systems.values()]
    .map(system => {
      const partNumbers = [...system.partNumbers];
      return {
        ...system,
        partNumbers,
        previewImages: system.diagrams.map(getPreferredImage).filter(Boolean).slice(0, 2),
        searchableText: normalise(
          `${system.title} ${system.diagrams.map(d => `${d.title} ${d.subtitle || ""}`).join(" ")} ${partNumbers.join(" ")} ${
            partNumbers.map(partNumber => partsByNumber.get(partNumber)?.description || "").join(" ")
          }`
        ),
        diagrams: system.diagrams.sort((a, b) =>
          getVariantSortKey(a).localeCompare(getVariantSortKey(b)) ||
          getVariantLabel(a).localeCompare(getVariantLabel(b))
        ),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

const allSystems = buildSystems();

function getVisibleSystems() {
  const query = normalise(state.globalQuery);
  if (!query) return allSystems;
  return allSystems.filter(system => system.searchableText.includes(query));
}

function getActiveSystem() {
  return allSystems.find(system => system.id === state.activeSystemId) || null;
}

function buildGroups(system) {
  if (!system) return [];

  const groups = new Map();
  for (const diagram of system.diagrams || []) {
    const title = getDiagramGroupTitle(diagram);
    const id = makeGroupId(system.id, title);
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        title,
        diagrams: [],
        partNumbers: new Set(),
      });
    }

    const group = groups.get(id);
    group.diagrams.push(diagram);
    for (const hotspot of diagram.hotspots || []) {
      if (hotspot.partNumber) group.partNumbers.add(hotspot.partNumber);
    }
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      partCount: group.partNumbers.size,
      diagrams: group.diagrams.sort((a, b) =>
        getVariantSortKey(a).localeCompare(getVariantSortKey(b)) ||
        getVariantLabel(a).localeCompare(getVariantLabel(b))
      ),
    }))
    .filter(group => group.partCount > 0)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function shouldUseGroupLanding(system) {
  const groups = buildGroups(system);
  if (groups.length <= 1) return false;
  return groups.some(group => normalise(group.title) !== normalise(system.title));
}

function getActiveGroup(system) {
  if (!system || !shouldUseGroupLanding(system)) return null;
  return buildGroups(system).find(group => group.id === state.activeGroupId) || null;
}

function getVisibleSubsystems(system) {
  if (!system) return [];
  if (!shouldUseGroupLanding(system)) return system.diagrams;

  const group = getActiveGroup(system);
  return group ? group.diagrams : [];
}

function getHotspotTargets(diagram) {
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

  return targets;
}

function buildRowsForDiagram(diagram) {
  if (!diagram) return [];
  const query = normalise(state.localQuery);
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

    if (!query || row.searchableText.includes(query)) rows.push(row);
  }

  return rows.sort((a, b) =>
    String(a.callout).localeCompare(String(b.callout), undefined, { numeric: true }) ||
    a.partNumber.localeCompare(b.partNumber)
  );
}

function renderSystems() {
  const visibleSystems = getVisibleSystems();
  systemList.innerHTML = "";
  systemCount.textContent = `${visibleSystems.length}`;

  for (const system of allSystems) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "system-item";
    if (system.id === state.activeSystemId) button.classList.add("active");
    if (!visibleSystems.some(item => item.id === system.id) && state.globalQuery) button.classList.add("dimmed");
    button.innerHTML = `
      <strong>${escapeHtml(system.title)}</strong>
      <span>${system.diagrams.length} sub systems | ${system.partNumbers.length} matched parts</span>
    `;
    button.addEventListener("click", () => {
      const useGroups = shouldUseGroupLanding(system);
      state.activeSystemId = system.id;
      state.activeGroupId = null;
      state.activeDiagramId = useGroups ? null : (system.diagrams[0]?.id || null);
      state.activeRowKey = null;
      state.localQuery = "";
      localSearch.value = "";
      if (isMobileViewport()) setMobileView(system.diagrams.length ? "subsystems" : "stage");
      render();
    });
    systemList.appendChild(button);
  }
}

function renderGroupLanding(system) {
  const groups = buildGroups(system);
  stageTitle.textContent = system.title;
  stageNote.textContent = "Select a family to open its variants, diagrams, and linked parts.";
  matchCount.textContent = `${system.partNumbers.length} indexed parts`;

  stageContent.innerHTML = `
    <div class="system-grid">
      ${groups.map(group => `
        <article class="system-card" data-group-id="${escapeHtml(group.id)}">
          ${group.diagrams[0] ? `
            <div class="system-card-gallery single">
              <img class="system-card-image" src="${encodeURI(getPreferredImage(group.diagrams[0]))}" alt="${escapeHtml(`${group.title} preview`)}" loading="lazy">
            </div>
          ` : ""}
          <h3>${escapeHtml(group.title)}</h3>
          <p>${group.diagrams.length} variants | ${group.partCount} matched parts</p>
        </article>
      `).join("")}
    </div>
  `;

  for (const card of stageContent.querySelectorAll(".system-card")) {
    card.addEventListener("click", () => {
      const group = groups.find(item => item.id === card.dataset.groupId);
      if (!group) return;
      state.activeGroupId = group.id;
      state.activeDiagramId = group.diagrams[0]?.id || null;
      state.activeRowKey = null;
      if (isMobileViewport()) setMobileView("subsystems");
      render();
    });
  }
}

function renderSubsystems(system) {
  subsystemList.innerHTML = "";
  const useGroups = shouldUseGroupLanding(system);
  const activeGroup = getActiveGroup(system);
  const groups = useGroups ? buildGroups(system) : [];
  const subsystems = getVisibleSubsystems(system);

  subsystemTitle.textContent = system
    ? (useGroups ? (activeGroup?.title || "Families") : system.title)
    : "Choose a system";
  subsystemCount.textContent = `${useGroups ? (activeGroup ? subsystems.length : groups.length) : subsystems.length}`;

  if (!system) {
    subsystemList.innerHTML = `
      <div class="empty-state">
        <h3>Sub systems will appear here</h3>
        <p>Select a system from the list above.</p>
      </div>
    `;
    return;
  }

  if (useGroups && !activeGroup) {
    for (const group of groups) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "subsystem-item";
      button.innerHTML = `
        <strong>${escapeHtml(group.title)}</strong>
        <span>${group.diagrams.length} variants | ${group.partCount} matched parts</span>
      `;
      button.addEventListener("click", () => {
        state.activeGroupId = group.id;
        state.activeDiagramId = group.diagrams[0]?.id || null;
        state.activeRowKey = null;
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
      state.activeGroupId = null;
      state.activeDiagramId = null;
      state.activeRowKey = null;
      render();
    });
    subsystemList.appendChild(backButton);
  }

  for (const diagram of subsystems) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "subsystem-item";
    if (diagram.id === state.activeDiagramId) button.classList.add("active");
    button.innerHTML = `
      <strong>${escapeHtml(diagram.title || system.title)}</strong>
      <span>${escapeHtml(getVariantLabel(diagram))}</span>
    `;
    button.addEventListener("click", () => {
      state.activeDiagramId = diagram.id;
      state.activeRowKey = null;
      if (isMobileViewport()) setMobileView("stage");
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

function renderDiagramRows(system) {
  if (!system) {
    const visibleSystems = getVisibleSystems();
    stageTitle.textContent = "All systems";
    stageNote.textContent = "Select a system to open its sub systems, diagrams, and linked parts.";
    matchCount.textContent = `${visibleSystems.reduce((sum, item) => sum + item.partNumbers.length, 0)} indexed parts`;

    stageContent.innerHTML = `
      <div class="system-grid">
        ${visibleSystems.map(item => `
          <article class="system-card" data-system-id="${escapeHtml(item.id)}">
            ${item.previewImages.length ? `
              <div class="system-card-gallery ${item.previewImages.length > 1 ? "dual" : "single"}">
                ${item.previewImages.map((src, index) => `
                  <img class="system-card-image" src="${encodeURI(src)}" alt="${escapeHtml(`${item.title} preview ${index + 1}`)}" loading="lazy">
                `).join("")}
              </div>
            ` : ""}
            <h3>${escapeHtml(item.title)}</h3>
            <p>${item.diagrams.length} sub systems | ${item.partNumbers.length} matched parts</p>
          </article>
        `).join("")}
      </div>
    `;

    for (const card of stageContent.querySelectorAll(".system-card")) {
      card.addEventListener("click", () => {
        const nextSystem = allSystems.find(item => item.id === card.dataset.systemId);
        if (!nextSystem) return;
        const useGroups = shouldUseGroupLanding(nextSystem);
        state.activeSystemId = nextSystem.id;
        state.activeGroupId = null;
        state.activeDiagramId = useGroups ? null : (nextSystem.diagrams[0]?.id || null);
        state.activeRowKey = null;
        if (isMobileViewport()) setMobileView(nextSystem.diagrams.length ? "subsystems" : "stage");
        render();
      });
    }
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
  if (!activeDiagram) return;

  const diagramRows = buildRowsForDiagram(activeDiagram);
  const visiblePncKeys = new Set(diagramRows.map(row => row.pncKey));
  const hotspotTargets = getHotspotTargets(activeDiagram);
  const activeRow = diagramRows.find(row => row.key === state.activeRowKey) || null;
  const activePncKey = activeRow?.pncKey || "";

  stageTitle.textContent = system.title;
  stageNote.textContent = useGroups
    ? `${activeGroup?.title || "Family"} | ${visibleSubsystems.length} variants | viewing: ${getVariantLabel(activeDiagram)}`
    : `${system.diagrams.length} sub systems | viewing: ${getVariantLabel(activeDiagram)}`;
  matchCount.textContent = `${system.partNumbers.length} indexed parts`;

  stageContent.innerHTML = `
    <div class="diagram-stack">
      <section class="diagram-row" id="diagram-row-${escapeHtml(activeDiagram.id)}">
        <article class="diagram-card">
          <div class="diagram-card-header">
            <h3>${escapeHtml(activeDiagram.title || system.title)}</h3>
            <div class="diagram-meta">${escapeHtml(getVariantLabel(activeDiagram))}</div>
          </div>
          <div class="diagram-canvas is-loading">
            <div class="diagram-loading">Loading diagram...</div>
            <div class="diagram-figure">
              <img
                class="diagram-image"
                src="${encodeURI(getPreferredImage(activeDiagram))}"
                alt="${escapeHtml(activeDiagram.title || system.title)}"
                decoding="async"
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
              <h3>${escapeHtml(activeDiagram.title || system.title)}</h3>
              <p class="panel-note">${escapeHtml(getVariantLabel(activeDiagram))}</p>
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

  function clearHover() {
    for (const el of stageContent.querySelectorAll(".hovered")) el.classList.remove("hovered");
  }

  function applyHover(pncKeyValue) {
    clearHover();
    if (!pncKeyValue) return;
    for (const el of stageContent.querySelectorAll(`[data-pnc-key="${CSS.escape(pncKeyValue)}"]`)) {
      el.classList.add("hovered");
    }
  }

  for (const hotspot of stageContent.querySelectorAll(".hotspot")) {
    hotspot.addEventListener("mouseenter", () => applyHover(hotspot.dataset.pncKey));
    hotspot.addEventListener("mouseleave", clearHover);
    hotspot.addEventListener("click", () => {
      const nextRow = diagramRows.find(row => row.pncKey === hotspot.dataset.pncKey) || null;
      state.activeDiagramId = hotspot.dataset.diagramId || state.activeDiagramId;
      state.activeRowKey = nextRow?.key || null;
      if (isMobileViewport()) setMobileView("stage");
      render();
      const expansion = stageContent.querySelector(".expansion-row");
      expansion?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  for (const row of stageContent.querySelectorAll("tbody tr[data-row-key]")) {
    row.addEventListener("mouseenter", () => applyHover(row.dataset.pncKey));
    row.addEventListener("mouseleave", clearHover);
    row.addEventListener("click", event => {
      if (event.target.closest("a")) return;
      const newKey = state.activeRowKey === row.dataset.rowKey ? null : (row.dataset.rowKey || null);
      state.activeRowKey = newKey;
      state.activeDiagramId = row.dataset.diagramId || state.activeDiagramId;
      if (isMobileViewport()) setMobileView("stage");
      render();
      if (newKey) {
        const expansion = stageContent.querySelector(".expansion-row");
        expansion?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  stageContent.addEventListener("click", event => {
    if (event.target.closest("a")) event.stopPropagation();
  }, true);

  for (const image of stageContent.querySelectorAll(".diagram-image")) {
    const canvas = image.closest(".diagram-canvas");
    const clearLoading = () => canvas?.classList.remove("is-loading");
    if (image.complete) {
      clearLoading();
      continue;
    }
    image.addEventListener("load", clearLoading, { once: true });
    image.addEventListener("error", clearLoading, { once: true });
  }
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
  const useGroups = shouldUseGroupLanding(system);

  if (useGroups) {
    const group = getActiveGroup(system);
    state.activeGroupId = group?.id || null;

    if (group && !group.diagrams.some(diagram => diagram.id === state.activeDiagramId)) {
      state.activeDiagramId = group.diagrams[0]?.id || null;
      state.activeRowKey = null;
    }

    if (!group) {
      state.activeDiagramId = null;
      state.activeRowKey = null;
    }
  } else {
    state.activeGroupId = null;
    if (system && !system.diagrams.some(diagram => diagram.id === state.activeDiagramId)) {
      state.activeDiagramId = system.diagrams[0]?.id || null;
      state.activeRowKey = null;
    }
  }

  if (system) {
    const activeDiagram = getVisibleSubsystems(system).find(diagram => diagram.id === state.activeDiagramId);
    if (activeDiagram) {
      const visibleRows = buildRowsForDiagram(activeDiagram);
      if (state.activeRowKey && !visibleRows.some(row => row.key === state.activeRowKey)) {
        state.activeRowKey = null;
      }
    }
  }

  renderSystems();
  renderSubsystems(system);
  renderDiagramRows(system);
  renderMobileNav();
  syncUrlState();
}

let globalSearchDebounce = 0;
let localSearchDebounce = 0;

globalSearch.addEventListener("input", event => {
  const value = event.target.value || "";
  clearTimeout(globalSearchDebounce);
  globalSearchDebounce = setTimeout(() => {
    state.globalQuery = value;
    render();
  }, 180);
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

window.addEventListener("resize", () => {
  syncMobileView();
  renderMobileNav();
});

window.addEventListener("hashchange", () => {
  if (isRestoringUrlState) return;
  applyUrlState();
  render();
});

applyUrlState();
render();

const catalog = window.CATALOG_DATA || { parts: [], diagrams: [] };

const state = {
  globalQuery: "",
  localQuery: "",
  activeSystemId: null,
  activeSubsystemId: null,
  activeRowKey: null,
  hoveredRowKey: null,
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

function canonicalSystemSlug(diagram) {
  const raw = normalise(diagram.viewFamilyTitle || diagram.title || diagram.id);
  return SYSTEM_MERGE_ALIASES.get(raw) || raw || "untitled-system";
}

function canonicalSystemTitle(diagram) {
  const rawTitle = String(diagram.viewFamilyTitle || diagram.title || "Untitled system").trim();
  const alias = SYSTEM_MERGE_ALIASES.get(normalise(rawTitle));
  return alias ? titleCase(alias) : rawTitle;
}

function makeSystemId(diagram) {
  return `system-${canonicalSystemSlug(diagram)}`;
}

function getVariantLabel(diagram) {
  return diagram.subtitle || diagram.title || diagram.id;
}

function getPreferredImage(diagram) {
  return diagram?.apiImageUrl || diagram?.imagePath || "";
}

function rowKey(diagramId, hotspot) {
  return `${diagramId}|${hotspot.callout || ""}|${hotspot.partNumber || ""}`;
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
  try { return new URL(sourceName).hostname.replace(/^www\./, ""); } catch { return sourceName; }
}

// Renders an outbound link that always works from file:// pages.
// Uses a data-href attribute + inline onclick so window.open() is called
// directly in the user's click gesture — this bypasses popup blockers that
// can interfere with target="_blank" on file:// origins.
function outboundLink(url, label, cssClass, titleText) {
  const safeUrl  = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  const safeCls  = escapeHtml(cssClass || "");
  const safeTitle = titleText ? ` title="${escapeHtml(titleText)}"` : "";
  return `<a href="${safeUrl}" data-href="${safeUrl}" class="${safeCls}"${safeTitle} onclick="event.preventDefault();event.stopPropagation();window.open(this.dataset.href,'_blank','noopener,noreferrer')">${safeLabel}</a>`;
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
        diagrams: system.diagrams.sort((a, b) => getVariantLabel(a).localeCompare(getVariantLabel(b))),
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

function getVisibleSubsystems(system) {
  return system ? system.diagrams : [];
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

function buildRowsForSystem(system) {
  if (!system) return [];
  return system.diagrams.flatMap(buildRowsForDiagram);
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
      <span>${system.diagrams.length} sub systems • ${system.partNumbers.length} matched parts</span>
    `;
    button.addEventListener("click", () => {
      state.activeSystemId = system.id;
      state.activeSubsystemId = system.diagrams[0]?.id || null;
      state.activeRowKey = null;
      state.hoveredRowKey = null;
      state.localQuery = "";
      localSearch.value = "";
      if (isMobileViewport()) setMobileView(system.diagrams.length ? "subsystems" : "stage");
      render();
    });
    systemList.appendChild(button);
  }
}

function renderSubsystems(system) {
  subsystemList.innerHTML = "";
  subsystemTitle.textContent = system ? system.title : "Choose a system";
  const subsystems = getVisibleSubsystems(system);
  subsystemCount.textContent = `${subsystems.length}`;

  if (!system) {
    subsystemList.innerHTML = `
      <div class="empty-state">
        <h3>Sub systems will appear here</h3>
        <p>Select a system from the list above.</p>
      </div>
    `;
    return;
  }

  for (const diagram of subsystems) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "subsystem-item";
    if (diagram.id === state.activeSubsystemId) button.classList.add("active");
    button.innerHTML = `
      <strong>${escapeHtml(diagram.title || system.title)}</strong>
      <span>${escapeHtml(getVariantLabel(diagram))}</span>
    `;
    button.addEventListener("click", () => {
      state.activeSubsystemId = diagram.id;
      if (isMobileViewport()) setMobileView("stage");
      document.getElementById(`diagram-row-${CSS.escape(diagram.id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      render();
    });
    subsystemList.appendChild(button);
  }
}

function renderSystemLanding(visibleSystems) {
  stageTitle.textContent = "All systems";
  stageNote.textContent = "Select a system to open its sub systems, diagrams, and linked parts.";
  matchCount.textContent = `${visibleSystems.reduce((sum, system) => sum + system.partNumbers.length, 0)} indexed parts`;

  stageContent.innerHTML = `
    <div class="system-grid">
      ${visibleSystems.map(system => `
        <article class="system-card" data-system-id="${escapeHtml(system.id)}">
          ${system.previewImages.length ? `
            <div class="system-card-gallery ${system.previewImages.length > 1 ? "dual" : "single"}">
              ${system.previewImages.map((src, index) => `
                <img class="system-card-image" src="${encodeURI(src)}" alt="${escapeHtml(`${system.title} preview ${index + 1}`)}" loading="lazy">
              `).join("")}
            </div>
          ` : ""}
          <h3>${escapeHtml(system.title)}</h3>
          <p>${system.diagrams.length} sub systems • ${system.partNumbers.length} matched parts</p>
        </article>
      `).join("")}
    </div>
  `;

  for (const card of stageContent.querySelectorAll(".system-card")) {
    card.addEventListener("click", () => {
      const system = allSystems.find(item => item.id === card.dataset.systemId);
      if (!system) return;
      state.activeSystemId = system.id;
      state.activeSubsystemId = system.diagrams[0]?.id || null;
      if (isMobileViewport()) setMobileView(system.diagrams.length ? "subsystems" : "stage");
      render();
    });
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
        <td>${escapeHtml(v.period || "—")}</td>
        <td>
          ${v.links?.[0]?.url
            ? outboundLink(v.links[0].url, v.partNumber, "pn-link")
            : escapeHtml(v.partNumber)
          }
          ${isCurrent ? `<span class="variant-current-badge">selected</span>` : ""}
        </td>
        <td>${escapeHtml(v.description || part.description || "—")}</td>
        <td>${escapeHtml(v.appliesDetails || "—")}</td>
        <td class="col-buy">${vLinks}</td>
      </tr>`;
  }).join("");

  const headBtns = (part.links || []).map(link =>
    outboundLink(link.url, supplierLabel(link.sourceName),
      `supplier-btn supplier-btn--${supplierKey(link.sourceName)}`)
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
        <p class="detail-variants-label">${allVariants.length} known variants for this part series — by production period</p>
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
    renderSystemLanding(getVisibleSystems());
    return;
  }

  // Only render the active sub-diagram — not all at once
  const activeDiagram = system.diagrams.find(d => d.id === state.activeSubsystemId) || system.diagrams[0];
  if (!activeDiagram) return;

  const diagramRows = buildRowsForDiagram(activeDiagram);
  const totalParts = system.partNumbers.length;

  stageTitle.textContent = system.title;
  stageNote.textContent = `${system.diagrams.length} sub systems • viewing: ${getVariantLabel(activeDiagram)}`;
  matchCount.textContent = `${totalParts} indexed parts`;

  const filteredKeys = new Set(diagramRows.map(row => row.key));

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
            <img
              class="diagram-image"
              src="${encodeURI(getPreferredImage(activeDiagram))}"
              alt="${escapeHtml(activeDiagram.title || system.title)}"
              decoding="async"
            >
            ${(activeDiagram.hotspots || []).map(hotspot => {
              const key = rowKey(activeDiagram.id, hotspot);
              const active = key === state.activeRowKey;
              const visible = filteredKeys.has(key);
              return `
                <button
                  class="hotspot${active ? " active" : ""}${visible ? "" : " dimmed"}"
                  style="left:${hotspot.x}%; top:${hotspot.y}%"
                  data-row-key="${escapeHtml(key)}"
                  data-diagram-id="${escapeHtml(activeDiagram.id)}"
                  type="button"
                  title="${escapeHtml(`${hotspot.callout} ${hotspot.partNumber}`)}"
                ></button>
              `;
            }).join("")}
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
                      data-diagram-id="${escapeHtml(row.diagramId)}"
                      class="${isActive ? "active" : ""}"
                      title="Click to see all variant part numbers"
                    >
                      <td class="col-oem">${primaryUrl
                        ? outboundLink(primaryUrl, row.partNumber, "pn-link")
                        : escapeHtml(row.partNumber)
                      }</td>
                      <td>${escapeHtml(row.description || "")}</td>
                      <td>${escapeHtml(row.appliesDetails || row.callout || "")}</td>
                      <td>${escapeHtml(row.period || "")}</td>
                      <td>${escapeHtml(row.notes || "")}</td>
                      <td class="col-buy">${supplierBtns}</td>
                    </tr>
                    ${isActive ? `
                    <tr class="expansion-row">
                      <td colspan="6">${renderPartDetailCard(row)}</td>
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

  // ── Hover highlighting (CSS-only, no re-render) ────────────────────────
  function clearHover() {
    for (const el of stageContent.querySelectorAll(".hovered")) el.classList.remove("hovered");
  }

  function applyHover(rowKeyValue) {
    clearHover();
    if (!rowKeyValue) return;
    for (const el of stageContent.querySelectorAll(`[data-row-key="${CSS.escape(rowKeyValue)}"]`)) {
      el.classList.add("hovered");
    }
  }

  for (const hotspot of stageContent.querySelectorAll(".hotspot")) {
    hotspot.addEventListener("mouseenter", () => applyHover(hotspot.dataset.rowKey));
    hotspot.addEventListener("mouseleave", clearHover);
    hotspot.addEventListener("click", () => {
      state.activeRowKey = hotspot.dataset.rowKey || null;
      state.activeSubsystemId = hotspot.dataset.diagramId || state.activeSubsystemId;
      if (isMobileViewport()) setMobileView("stage");
      render();
      const expansion = stageContent.querySelector(".expansion-row");
      expansion?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  for (const row of stageContent.querySelectorAll("tbody tr[data-row-key]")) {
    row.addEventListener("mouseenter", () => applyHover(row.dataset.rowKey));
    row.addEventListener("mouseleave", clearHover);
    row.addEventListener("click", event => {
      if (event.target.closest("a")) return;
      const newKey = state.activeRowKey === row.dataset.rowKey ? null : (row.dataset.rowKey || null);
      state.activeRowKey = newKey;
      state.activeSubsystemId = row.dataset.diagramId || state.activeSubsystemId;
      if (isMobileViewport()) setMobileView("stage");
      render();
      if (newKey) {
        const expansion = stageContent.querySelector(".expansion-row");
        expansion?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  // Links inside the table should not trigger row-select.
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
    state.activeSubsystemId = null;
    state.activeRowKey = null;
  }

  const system = getActiveSystem();

  if (system) {
    const activeDiagram = system.diagrams.find(d => d.id === state.activeSubsystemId) || system.diagrams[0];
    if (activeDiagram) {
      const visibleRows = buildRowsForDiagram(activeDiagram);
      if (state.activeRowKey && !visibleRows.some(row => row.key === state.activeRowKey)) state.activeRowKey = null;
    }
  }

  renderSystems();
  renderSubsystems(system);
  renderDiagramRows(system);
  renderMobileNav();
}

let _debounceGlobal = 0;
let _debounceLocal = 0;

globalSearch.addEventListener("input", event => {
  const value = event.target.value || "";
  clearTimeout(_debounceGlobal);
  _debounceGlobal = setTimeout(() => {
    state.globalQuery = value;
    render();
  }, 180);
});

localSearch.addEventListener("input", event => {
  const value = event.target.value || "";
  clearTimeout(_debounceLocal);
  _debounceLocal = setTimeout(() => {
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

render();

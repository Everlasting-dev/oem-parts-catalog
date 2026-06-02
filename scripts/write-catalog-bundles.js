'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const FULL_BUNDLE_PATH = path.join(DATA_DIR, 'catalog-data.js');
const MANIFEST_JS_PATH = path.join(DATA_DIR, 'catalog-manifest.js');
const MANIFEST_JSON_PATH = path.join(DATA_DIR, 'catalog-manifest.json');
const PART_INDEX_JS_PATH = path.join(DATA_DIR, 'catalog-part-index.js');
const CHUNK_DIR = path.join(DATA_DIR, 'catalog-systems');

const SYSTEM_MERGE_ALIASES = new Map([
  ['alternator fitting', 'alternator'],
  ['anti skid control chassis', 'anti skid control'],
  ['wiring denso', 'wiring'],
  ['manifold engine', 'manifold'],
  ['floor panel rear', 'floor panel'],
]);

const API_IMAGE_HOST_PREFIXES = new Map([
  ['epc.partsbooster.com', '51da2d'],
  ['nissan-img.amayama.com', 'e97905'],
]);

const UI_TRANSLATIONS = [
  [/EGI\s*ï¾Šï½°ï¾ˆï½½\s*1/gi, 'EGI HARN 1'],
  [/EGI\s*ï¾Šï½°ï¾ˆï½½\s*2/gi, 'EGI HARN 2'],
  [/ALTNTR\s*ï¾Šï½°ï¾ˆï½½/gi, 'ALTNTR HARN'],
  [/ï½´ï¾ï½¼ï¾žï¾\s*ï¾™ï½°ï¾‘/gi, 'ENGINE ROOM HARN'],
  [/ï¾’ï½²ï¾\s*ï¾Šï½°ï¾ˆï½½/gi, 'MAIN HARN'],
  [/ï¾™ï½°ï¾‘ï¾—ï¾ï¾Œï¾Ÿ\s*&\s*ï¾„ï¾žï½±\s*ï¾Šï½°ï¾ˆï½½/gi, 'ROOM LAMP & DOOR HARN'],
  [/ï¾Žï¾žï¾ƒï¾žï½¨\s*ï¾Šï½°ï¾ˆï½½\s*1/gi, 'BODY HARN 1'],
  [/ï¾Žï¾žï¾ƒï¾žï½¨\s*ï¾Šï½°ï¾ˆï½½\s*2/gi, 'BODY HARN 2'],
  [/ï¾Šï¾žï½¯ï¾ƒï¾˜ï½°ï¾ï¾œï¾˜/gi, 'BATTERY AREA'],
  [/ï¾Šï¾Ÿï½²ï¾‹ï¾Ÿï¾ï½¸ï¾ž1ï¼†ï½·ï½¬ï¾†ï½½ï¾€ï½°/gi, 'PIPING 1 & CANISTER'],
  [/ï¾Šï¾Ÿï½²ï¾‹ï¾Ÿï¾ï½¸ï¾ž2ï¼†ï½¾ï¾ï½»ï½°\(YEARA\)/gi, 'PIPING 2 & SENSOR (YEAR A)'],
  [/ï¾Šï¾Ÿï½²ï¾‹ï¾Ÿï¾ï½¸ï¾ž2ï¼†ï½¾ï¾ï½»ï½°/gi, 'PIPING 2 & SENSOR'],
  [/ãƒ‘ã‚¤ãƒ”ãƒ³ã‚°1ï¼†ã‚­ãƒ£ãƒ‹ã‚¹ã‚¿ãƒ¼/gi, 'PIPING 1 & CANISTER'],
  [/ãƒ‘ã‚¤ãƒ”ãƒ³ã‚°2ï¼†ã‚»ãƒ³ã‚µãƒ¼\(YEARA\)/gi, 'PIPING 2 & SENSOR (YEAR A)'],
  [/ãƒ‘ã‚¤ãƒ”ãƒ³ã‚°2ï¼†ã‚»ãƒ³ã‚µãƒ¼/gi, 'PIPING 2 & SENSOR'],
  [/ã‚¨ãƒ³ã‚¸ãƒ³ãƒ«ãƒ¼ãƒ /gi, 'ENGINE ROOM HARN'],
  [/ã‚¨ãƒ³ã‚¸ãƒ³ ãƒ«ãƒ¼ãƒ /gi, 'ENGINE ROOM HARN'],
  [/ãƒœãƒ‡ã‚£ãƒãƒ¼ãƒã‚¹\s*1/gi, 'BODY HARN 1'],
  [/ãƒœãƒ‡ã‚£ãƒãƒ¼ãƒã‚¹\s*2/gi, 'BODY HARN 2'],
  [/ãƒ¡ã‚¤ãƒ³ãƒãƒ¼ãƒã‚¹/gi, 'MAIN HARN'],
];

const DISPLAY_TEXT_REPLACEMENTS = [
  [/\bALTNTR HARN\b/gi, 'Alternator Harness'],
  [/\bENGINE ROOM HARN\b/gi, 'Engine Room Harness'],
  [/\bMAIN HARN\b/gi, 'Main Harness'],
  [/\bROOM LAMP & DOOR HARN\b/gi, 'Room Lamp & Door Harness'],
  [/\bBODY HARN 1\b/gi, 'Body Harness 1'],
  [/\bBODY HARN 2\b/gi, 'Body Harness 2'],
  [/\bBODY HARN LH\b/gi, 'Body Harness Left'],
  [/\bBODY HARN RH\b/gi, 'Body Harness Right'],
  [/\bEGI HARN 1\b/gi, 'EGI Harness 1'],
  [/\bEGI HARN 2\b/gi, 'EGI Harness 2'],
  [/\bRR SEN HARN\b/gi, 'Rear Sensor Harness'],
  [/\bPIPING1&CANISTER\b/gi, 'Piping 1 & Canister'],
  [/\bPIPING2&SENSOR\b/gi, 'Piping 2 & Sensor'],
  [/\bINST PAD & CLUSTER LID\b/gi, 'Instrument Panel & Cluster Lid'],
  [/\bE\/G MOUNT\b/gi, 'Engine Mount'],
  [/\bNOMAL\b/gi, 'Normal'],
  [/\bWiring\s*\(denso\)\b/gi, 'Wiring'],
];

const MINOR_LABEL_TOKENS = new Set([
  'assy',
  'assembly',
  'set',
  'kit',
  'part',
  'parts',
]);

const GENERIC_DIAGRAM_TITLES = new Set([
  'diagram',
  'electrical',
  'electrical unit',
  'fitting',
  'harness',
  'hose',
  'layout',
  'parts',
  'piping',
  'unit',
  'wiring',
]);

const CATEGORY_DEFINITIONS = [
  {
    key: 'electrical',
    title: 'Electrical & Wiring',
    description: 'Wiring, modules, relays, battery, lighting, and electronics',
    patterns: [
      /\bwiring\b/, /\bharness\b/, /\belectrical\b/, /\brelay\b/, /\bswitch\b/, /\bbattery\b/,
      /\balternator\b/, /\bstarter\b/, /\bignition\b/, /\bengine control\b/, /\bcontrol module\b/,
      /\bdistributor\b/, /\bmeter\b/, /\bgauge\b/, /\baudio\b/, /\btelephone\b/, /\bspeaker\b/,
      /\blamp\b/, /\bheadlamp\b/, /\blighting\b/, /\bwiper\b/, /\bwasher\b/, /\bkey set\b/,
    ],
  },
  {
    key: 'engine',
    title: 'Engine & Turbo',
    description: 'Core engine assemblies, manifolds, turbo, and lubrication',
    patterns: [
      /\bengine\b/, /\bcylinder\b/, /\bpiston\b/, /\bcrankshaft\b/, /\bcamshaft\b/,
      /\bvalve\b/, /\bmanifold\b/, /\bturbo\b/, /\bthrottle\b/, /\blubricating\b/,
      /\bair cleaner\b/, /\bcrankcase\b/, /\bgasket kit\b/, /\bbare short\b/, /\bfront cover\b/,
    ],
  },
  {
    key: 'steering',
    title: 'Steering',
    description: 'Steering wheel, column, gear, and power steering systems',
    patterns: [/\bsteering\b/, /\bpower steering\b/],
  },
  {
    key: 'chassis',
    title: 'Suspension & Brakes',
    description: 'Suspension, wheels, brakes, anti-skid, and pedal systems',
    patterns: [
      /\bsuspension\b/, /\bwheel\b/, /\btire\b/, /\bbrake\b/, /\banti skid\b/,
      /\bmaster cylinder\b/, /\bservo\b/, /\bpedal\b/,
    ],
  },
  {
    key: 'fuel-cooling',
    title: 'Fuel, Cooling & Exhaust',
    description: 'Fuel delivery, cooling, vacuum, radiator, and exhaust systems',
    patterns: [
      /\bfuel\b/, /\bwater\b/, /\bcooling\b/, /\bradiator\b/, /\boil cooler\b/, /\bvacuum\b/,
      /\bevap\b/, /\bhose\b/, /\bpiping\b/, /\bexhaust\b/, /\bcatalyst\b/, /\bmuffler\b/,
      /\baccelerator linkage\b/, /\bsecondary air\b/,
    ],
  },
  {
    key: 'climate',
    title: 'HVAC & Climate',
    description: 'Heater, blower, condenser, ducts, and cabin climate controls',
    patterns: [
      /\bheater\b/, /\bblower\b/, /\bcooling unit\b/, /\bcompressor\b/, /\bcondenser\b/,
      /\bnozzle\b/, /\bduct\b/, /\bventilator\b/, /\bcontrol unit\b/, /\bheater piping\b/,
    ],
  },
  {
    key: 'drivetrain',
    title: 'Transmission & Driveline',
    description: 'Transmission, transfer, shafts, axles, and final drives',
    patterns: [
      /\btransmission\b/, /\btransaxle\b/, /\btransfer\b/, /\bpropeller shaft\b/, /\bdrive shaft\b/,
      /\bfinal drive\b/, /\bgear\b/, /\baxle\b/, /\bclutch release\b/, /\bauto transmission\b/,
    ],
  },
  {
    key: 'body',
    title: 'Body & Exterior',
    description: 'Body panels, bumpers, glass, doors, trunk, and exterior trim',
    patterns: [
      /\bbumper\b/, /\bfender\b/, /\bhood\b/, /\bcowl\b/, /\broof\b/, /\bfloor panel\b/,
      /\bmember\b/, /\bbody side\b/, /\bapron\b/, /\bdash panel\b/, /\bwindshield\b/,
      /\bwindow\b/, /\bdoor\b/, /\btrunk\b/, /\bmirror\b/, /\bspoiler\b/, /\bemblem\b/,
      /\blabel\b/, /\bplate\b/, /\brear back panel\b/,
    ],
  },
  {
    key: 'interior',
    title: 'Interior & Trim',
    description: 'Dash, console, seats, luggage trim, and cabin finishing parts',
    patterns: [
      /\bdash trimming\b/, /\binstrument panel\b/, /\bconsole\b/, /\bseat\b/, /\bsunvisor\b/,
      /\btrimming\b/, /\bluggage room\b/, /\bfloor fitting\b/, /\bfloor trimming\b/,
    ],
  },
  {
    key: 'general',
    title: 'General & Service',
    description: 'Service items, manuals, and uncategorized catalog entries',
    patterns: [],
  },
];

function normalise(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizePartNumber(partNumber) {
  return String(partNumber || '').trim().toUpperCase().replace(/\s+/g, '');
}

function compactPartNumber(partNumber) {
  return normalizePartNumber(partNumber).replace(/[^A-Z0-9]/g, '');
}

function ocrCanonicalPartNumber(partNumber) {
  return compactPartNumber(partNumber)
    .replace(/[OQD]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6');
}

function titleCase(text) {
  return String(text || '')
    .split(' ')
    .map(chunk => (chunk ? chunk[0].toUpperCase() + chunk.slice(1) : chunk))
    .join(' ');
}

function translateUiText(text) {
  let value = String(text || '');
  for (const [pattern, replacement] of UI_TRANSLATIONS) {
    value = value.replace(pattern, replacement);
  }
  return value;
}

function normalizeDisplaySource(text) {
  return String(text || '')
    .replace(/ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢|ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢|â€¢|Â·/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim();
}

function smartTitleCase(text) {
  return String(text || '')
    .split(/(\s+|[|/&(),-]+)/)
    .map(token => {
      if (!/[a-zA-Z]/.test(token)) return token;
      if (token === token.toUpperCase() && token.length > 1) return token;
      return token[0].toUpperCase() + token.slice(1).toLowerCase();
    })
    .join('');
}

function beautifyDisplayText(text, options = {}) {
  const { preserveCase = false } = options;
  let value = translateUiText(normalizeDisplaySource(text || ''));

  for (const [pattern, replacement] of DISPLAY_TEXT_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }

  value = value
    .replace(/\[(.*?)\]/g, '$1')
    .replace(/\s*;\s*/g, ' | ')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .replace(/\|\s*\|/g, '|')
    .replace(/[|\s-]+$/g, '')
    .trim();

  return preserveCase ? value : smartTitleCase(value);
}

function splitMetaTokens(text) {
  return beautifyDisplayText(text, { preserveCase: true })
    .split('|')
    .flatMap(chunk => chunk.split(/\s*;\s*/))
    .map(chunk => chunk.trim())
    .filter(Boolean);
}

function normalizePeriod(value) {
  const match = String(value || '').match(/(\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{4}|\.\.\.)/);
  return match ? `${match[1]} - ${match[2]}` : '';
}

function looksLikeModelCode(value) {
  const text = String(value || '').trim();
  if (!text || normalizePeriod(text)) return false;
  return /^[*A-Z0-9.+()/-]+$/.test(text);
}

function isHelpfulVariantPrimary(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/[.!?]/.test(text)) return false;
  if (text.split(/\s+/).length > 6) return false;
  return text.length <= 48;
}

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

function shouldUseVariantPrimaryAsTitle(primary, fallback, systemTitle = '') {
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
      ? `${diagram.pageVariantLabel} | ${diagram.subtitle || ''}`
      : diagram.subtitle || ''
  );

  let primary = '';
  let period = '';
  let model = '';

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
  const raw = typeof systemOrDiagram === 'string'
    ? systemOrDiagram
    : (systemOrDiagram?.title || systemOrDiagram?.viewFamilyTitle || '');
  return beautifyDisplayText(raw || 'Untitled system');
}

function getGroupDisplayTitle(title) {
  return beautifyDisplayText(title || 'Family');
}

function getDiagramDisplayTitle(diagram, systemTitle = '') {
  const fallback = beautifyDisplayText(diagram?.title || systemTitle || 'Untitled diagram');
  const meta = buildVariantMeta(diagram || {});
  if (shouldUseVariantPrimaryAsTitle(meta.primary, fallback, systemTitle)) {
    return meta.primary;
  }
  return fallback;
}

function getDiagramSecondaryLabel(diagram, systemTitle = '') {
  const fallback = beautifyDisplayText(diagram?.title || systemTitle || '');
  const meta = buildVariantMeta(diagram || {});
  const bits = [];

  if (shouldUseVariantPrimaryAsTitle(meta.primary, fallback, systemTitle)) {
    bits.push(fallback);
  }

  if (meta.period) bits.push(meta.period);
  if (meta.model) bits.push(meta.model);

  return bits.join(' | ');
}

function getVariantLabel(diagram) {
  const base = beautifyDisplayText(diagram.subtitle || diagram.title || diagram.id, { preserveCase: true });
  return diagram.pageVariantLabel
    ? `${beautifyDisplayText(diagram.pageVariantLabel, { preserveCase: true })} | ${base}`
    : base;
}

function getVariantSortKey(diagram) {
  return diagram?.sortKey || getVariantLabel(diagram);
}

function getDiagramGroupTitle(diagram) {
  function normalizeFamilyName(rawText) {
    const text = beautifyDisplayText(rawText || '', { preserveCase: true });
    if (!text) return '';

    const specMatch = text.match(/specification:\s*([^;|]+)/i);
    if (specMatch) return getGroupDisplayTitle(specMatch[1].trim());

    const beforeDateMatch = text.match(/^(.+?)\s*\|\s*\d{2}\.\d{4}\s*-\s*(?:\d{2}\.\d{4}|\.\.\.)/i);
    if (beforeDateMatch) return getGroupDisplayTitle(beforeDateMatch[1].trim());

    const firstChunk = text.split('|').map(chunk => chunk.trim()).filter(Boolean)[0] || '';
    const cleaned = firstChunk
      .replace(/app\.\s*model:.*$/i, '')
      .replace(/[|\s-]+$/g, '')
      .trim();
    return getGroupDisplayTitle(cleaned);
  }

  const fromSubtitle = normalizeFamilyName(diagram?.subtitle || '');
  if (
    fromSubtitle &&
    isHelpfulVariantPrimary(fromSubtitle) &&
    !/^app\.\s*model/i.test(fromSubtitle) &&
    !/^imported from amayama/i.test(fromSubtitle)
  ) {
    return fromSubtitle;
  }

  const fromTitle = normalizeFamilyName(diagram?.title || '');
  if (fromTitle && !/^imported from amayama/i.test(fromTitle)) {
    return fromTitle;
  }

  return 'Family';
}

function canonicalSystemSlug(diagram) {
  const raw = normalise(diagram.viewFamilyTitle || diagram.title || diagram.id);
  return SYSTEM_MERGE_ALIASES.get(raw) || raw || 'untitled-system';
}

function canonicalSystemTitle(diagram) {
  const rawTitle = String(diagram.viewFamilyTitle || diagram.title || 'Untitled system').trim();
  const alias = SYSTEM_MERGE_ALIASES.get(normalise(rawTitle));
  return getSystemDisplayTitle(alias ? titleCase(alias) : rawTitle);
}

function getCachedApiImage(diagram) {
  const existing = String(diagram?.imagePath || '');
  if (existing.startsWith('assets/diagrams/api/')) return existing;

  const url = String(diagram?.apiImageUrl || '').trim();
  if (!url) return '';

  try {
    const parsed = new URL(url);
    const prefix = API_IMAGE_HOST_PREFIXES.get(parsed.hostname);
    const fileName = parsed.pathname.split('/').pop();
    if (!prefix || !fileName) return '';
    const safeName = fileName.includes('.') ? fileName : `${fileName}.png`;
    return `assets/diagrams/api/${prefix}_${safeName}`;
  } catch {
    return '';
  }
}

function getPreferredImage(diagram) {
  return getCachedApiImage(diagram) || diagram?.imagePath || diagram?.apiImageUrl || '';
}

function getFallbackImage(diagram) {
  const primary = getPreferredImage(diagram);
  const candidates = [
    getCachedApiImage(diagram),
    diagram?.apiImageUrl,
    diagram?.imagePath,
  ].filter(Boolean);
  return candidates.find(candidate => candidate !== primary) || '';
}

function getSystemCategoryDefinition(system) {
  const haystack = normalise(
    [
      system?.title || '',
      ...(system?.diagrams || []).flatMap(diagram => [
        diagram.title || '',
        diagram.subtitle || '',
        diagram.pageVariantLabel || '',
        diagram.viewFamilyTitle || '',
      ]),
    ].join(' ')
  );

  for (const category of CATEGORY_DEFINITIONS) {
    if (category.patterns.some(pattern => pattern.test(haystack))) return category;
  }

  return CATEGORY_DEFINITIONS.find(category => category.key === 'general');
}

function makeSystemId(diagram) {
  return `system-${canonicalSystemSlug(diagram)}`;
}

function makeGroupId(systemId, title) {
  return `${systemId}::${normalise(title) || 'group'}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildSystemManifest(catalog) {
  const partsByNumber = new Map((catalog.parts || []).map(part => [part.partNumber, part]));
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

  const manifestSystems = [...systems.values()]
    .map(system => {
      const sortedDiagrams = system.diagrams
        .map(diagram => {
          const preferredImage = getPreferredImage(diagram);
          const fallbackImage = getFallbackImage(diagram);
          const displayTitle = getDiagramDisplayTitle(diagram, system.title);
          const secondaryLabel = getDiagramSecondaryLabel(diagram, system.title);
          const groupTitle = getDiagramGroupTitle(diagram);
          const partNumbers = unique((diagram.hotspots || []).map(hotspot => hotspot.partNumber));
          return {
            id: diagram.id,
            title: diagram.title || '',
            subtitle: diagram.subtitle || '',
            pageVariantLabel: diagram.pageVariantLabel || '',
            sortKey: diagram.sortKey || '',
            viewFamilyTitle: diagram.viewFamilyTitle || '',
            imagePath: diagram.imagePath || '',
            apiImageUrl: diagram.apiImageUrl || '',
            preferredImage,
            fallbackImage,
            displayTitle,
            secondaryLabel,
            groupTitle,
            partCount: partNumbers.length,
            searchableText: normalise(
              `${displayTitle} ${secondaryLabel} ${diagram.title || ''} ${diagram.subtitle || ''} ${diagram.pageVariantLabel || ''} ${diagram.viewFamilyTitle || ''}`
            ),
          };
        })
        .sort((left, right) =>
          getVariantSortKey(left).localeCompare(getVariantSortKey(right)) ||
          getVariantLabel(left).localeCompare(getVariantLabel(right))
        );

      const groups = new Map();
      for (const diagram of sortedDiagrams) {
        const groupId = makeGroupId(system.id, diagram.groupTitle);
        if (!groups.has(groupId)) {
          groups.set(groupId, {
            id: groupId,
            title: diagram.groupTitle,
            diagramIds: [],
            partNumbers: new Set(),
          });
        }
        const group = groups.get(groupId);
        group.diagramIds.push(diagram.id);
        const sourceDiagram = system.diagrams.find(item => item.id === diagram.id);
        for (const hotspot of sourceDiagram?.hotspots || []) {
          if (hotspot.partNumber) group.partNumbers.add(hotspot.partNumber);
        }
      }

      const manifestGroups = [...groups.values()]
        .map(group => {
          const previewDiagram = sortedDiagrams.find(diagram => group.diagramIds.includes(diagram.id) && diagram.preferredImage) || null;
          return {
            id: group.id,
            title: group.title,
            diagramIds: group.diagramIds,
            partCount: group.partNumbers.size,
            previewImage: previewDiagram?.preferredImage || '',
            previewFallbackImage: previewDiagram?.fallbackImage || '',
            searchableText: normalise(
              `${group.title} ${group.diagramIds.map(diagramId => {
                const diagram = sortedDiagrams.find(item => item.id === diagramId);
                return `${diagram?.displayTitle || ''} ${diagram?.secondaryLabel || ''}`;
              }).join(' ')}`
            ),
          };
        })
        .sort((left, right) => left.title.localeCompare(right.title));

      const previewDiagram = sortedDiagrams.find(diagram => diagram.preferredImage) || null;
      const category = getSystemCategoryDefinition({
        title: system.title,
        diagrams: system.diagrams,
      });

      const partNumbers = [...system.partNumbers];
      return {
        id: system.id,
        title: system.title,
        partCount: partNumbers.length,
        previewImage: previewDiagram?.preferredImage || '',
        previewFallbackImage: previewDiagram?.fallbackImage || '',
        previewImages: sortedDiagrams.map(diagram => diagram.preferredImage).filter(Boolean).slice(0, 2),
        searchableText: normalise(
          `${system.title} ${sortedDiagrams.map(diagram => `${diagram.displayTitle} ${diagram.secondaryLabel}`).join(' ')} ${partNumbers.join(' ')} ${
            partNumbers.map(partNumber => partsByNumber.get(partNumber)?.description || '').join(' ')
          } ${partNumbers.map(compactPartNumber).join(' ')}`
        ),
        diagrams: sortedDiagrams,
        groups: manifestGroups,
        useGroupLanding: manifestGroups.length > 1
          && manifestGroups.some(group => normalise(group.title) !== normalise(system.title)),
        categoryKey: category.key,
        categoryTitle: category.title,
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  const categories = new Map(
    CATEGORY_DEFINITIONS.map(category => [category.key, {
      ...category,
      systemIds: [],
      systemCount: 0,
      partCount: 0,
      previewImage: '',
      previewFallbackImage: '',
    }])
  );

  for (const system of manifestSystems) {
    const category = categories.get(system.categoryKey);
    category.systemIds.push(system.id);
    category.systemCount += 1;
    category.partCount += system.partCount;
    if (!category.previewImage && system.previewImage) {
      category.previewImage = system.previewImage;
      category.previewFallbackImage = system.previewFallbackImage || '';
    }
  }

  return {
    systems: manifestSystems,
    categories: CATEGORY_DEFINITIONS
      .map(definition => categories.get(definition.key))
      .filter(category => category.systemIds.length > 0),
  };
}

function buildPartIndex(catalog, systems) {
  const systemsById = new Map(systems.map(system => [system.id, system]));
  const locationsByPartNumber = new Map();

  for (const diagram of catalog.diagrams || []) {
    const systemId = makeSystemId(diagram);
    const system = systemsById.get(systemId);
    if (!system) continue;

    const groupTitle = getDiagramGroupTitle(diagram);
    const diagramTitle = getDiagramDisplayTitle(diagram, system.title);
    const diagramSecondaryLabel = getDiagramSecondaryLabel(diagram, system.title);
    const groupId = makeGroupId(systemId, groupTitle);
    const seenPartNumbers = new Set();

    for (const hotspot of diagram.hotspots || []) {
      const partNumber = normalizePartNumber(hotspot.partNumber);
      if (!partNumber || seenPartNumbers.has(partNumber)) continue;

      seenPartNumbers.add(partNumber);
      if (!locationsByPartNumber.has(partNumber)) locationsByPartNumber.set(partNumber, []);
      locationsByPartNumber.get(partNumber).push({
        systemId,
        systemTitle: system.title,
        groupId,
        groupTitle,
        diagramId: diagram.id,
        diagramTitle,
        diagramSecondaryLabel,
        callout: hotspot.callout || '',
      });
    }
  }

  return (catalog.parts || [])
    .map(part => {
      const partNumber = normalizePartNumber(part.partNumber);
      const locations = locationsByPartNumber.get(partNumber) || [];

      return {
        partNumber,
        description: part.description || '',
        appliesDetails: part.appliesDetails || '',
        period: part.period || '',
        locations: locations.slice(0, 8),
      };
    })
    .sort((left, right) => left.partNumber.localeCompare(right.partNumber));
}

function buildReverseRelations(parts) {
  const reverse = new Map();

  for (const part of parts || []) {
    for (const relatedPartNumber of part.relatedPartNumbers || []) {
      if (!reverse.has(relatedPartNumber)) reverse.set(relatedPartNumber, new Set());
      reverse.get(relatedPartNumber).add(part.partNumber);
    }
  }

  return reverse;
}

function collectChunkParts(diagrams, partsByNumber, reverseRelations) {
  const queue = unique(diagrams.flatMap(diagram => (diagram.hotspots || []).map(hotspot => hotspot.partNumber)));
  const seen = new Set(queue);

  for (let index = 0; index < queue.length; index += 1) {
    const partNumber = queue[index];
    const part = partsByNumber.get(partNumber);
    const relatedPartNumbers = new Set([
      ...(part?.relatedPartNumbers || []),
      ...(reverseRelations.get(partNumber) || []),
    ]);

    for (const relatedPartNumber of relatedPartNumbers) {
      if (!partsByNumber.has(relatedPartNumber) || seen.has(relatedPartNumber)) continue;
      seen.add(relatedPartNumber);
      queue.push(relatedPartNumber);
    }
  }

  return queue
    .map(partNumber => partsByNumber.get(partNumber))
    .filter(Boolean)
    .sort((left, right) => left.partNumber.localeCompare(right.partNumber));
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function clearChunkDirectory(dirPath) {
  ensureDirectory(dirPath);
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    fs.unlinkSync(path.join(dirPath, entry.name));
  }
}

function createChunkFileMap(systems) {
  const usedNames = new Set();
  const map = new Map();

  for (const system of systems) {
    const baseName = normalise(system.id).replace(/\s+/g, '-').replace(/-+/g, '-') || 'system';
    let nextName = baseName;
    let suffix = 2;
    while (usedNames.has(nextName)) {
      nextName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    usedNames.add(nextName);
    map.set(system.id, `${nextName}.js`);
  }

  return map;
}

function writeCatalogBundles(catalog, options = {}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : PROJECT_ROOT;
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : path.join(projectRoot, 'data');
  const fullBundlePath = path.join(dataDir, path.basename(FULL_BUNDLE_PATH));
  const manifestJsPath = path.join(dataDir, path.basename(MANIFEST_JS_PATH));
  const manifestJsonPath = path.join(dataDir, path.basename(MANIFEST_JSON_PATH));
  const partIndexJsPath = path.join(dataDir, path.basename(PART_INDEX_JS_PATH));
  const chunkDir = path.join(dataDir, path.basename(CHUNK_DIR));

  ensureDirectory(dataDir);
  clearChunkDirectory(chunkDir);

  const { systems, categories } = buildSystemManifest(catalog);
  const partIndex = buildPartIndex(catalog, systems);
  const chunkFileMap = createChunkFileMap(systems);
  const partsByNumber = new Map((catalog.parts || []).map(part => [part.partNumber, part]));
  const reverseRelations = buildReverseRelations(catalog.parts || []);

  for (const system of systems) {
    system.chunkPath = `data/catalog-systems/${chunkFileMap.get(system.id)}`;
  }

  for (const system of systems) {
    const sourceDiagrams = (catalog.diagrams || []).filter(diagram => makeSystemId(diagram) === system.id);
    const chunk = {
      systemId: system.id,
      diagrams: sourceDiagrams,
      parts: collectChunkParts(sourceDiagrams, partsByNumber, reverseRelations),
    };
    const payload = JSON.stringify(chunk);
    const chunkSource = `window.CATALOG_SYSTEM_CHUNKS=window.CATALOG_SYSTEM_CHUNKS||{};window.CATALOG_SYSTEM_CHUNKS[${JSON.stringify(system.id)}]=${payload};`;
    fs.writeFileSync(path.join(chunkDir, chunkFileMap.get(system.id)), chunkSource, 'utf8');
  }

  const manifest = {
    importedAt: catalog.importedAt || '',
    workbookPath: catalog.workbookPath || '',
    sources: catalog.sources || [],
    totalPartCount: catalog.parts?.length || 0,
    totalDiagramCount: catalog.diagrams?.length || 0,
    partIndexPath: 'data/catalog-part-index.js',
    systems,
    categories,
  };

  const fullBundle = `window.CATALOG_DATA=${JSON.stringify(catalog)};`;
  const manifestJson = JSON.stringify(manifest);
  const manifestBundle = `window.CATALOG_BOOTSTRAP=${manifestJson};`;
  const partIndexBundle = `window.CATALOG_PART_INDEX=${JSON.stringify(partIndex)};`;

  fs.writeFileSync(fullBundlePath, fullBundle, 'utf8');
  fs.writeFileSync(manifestJsPath, manifestBundle, 'utf8');
  fs.writeFileSync(manifestJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(partIndexJsPath, partIndexBundle, 'utf8');

  return {
    manifestPath: manifestJsPath,
    manifestJsonPath,
    partIndexPath: partIndexJsPath,
    chunkDir,
    fullBundlePath,
    manifestSize: Buffer.byteLength(manifestBundle),
    partIndexSize: Buffer.byteLength(partIndexBundle),
    fullBundleSize: Buffer.byteLength(fullBundle),
    systemCount: systems.length,
    categoryCount: categories.length,
  };
}

function loadCatalogFromDisk(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

function main() {
  const inputPath = path.resolve(PROJECT_ROOT, process.argv[2] || path.join('data', 'catalog-data.json'));
  const catalog = loadCatalogFromDisk(inputPath);
  const result = writeCatalogBundles(catalog, {
    projectRoot: PROJECT_ROOT,
    dataDir: path.dirname(inputPath),
  });

  console.log(`Wrote browser bundles for ${result.systemCount} systems.`);
  console.log(`Manifest: ${path.relative(PROJECT_ROOT, result.manifestPath)} (${(result.manifestSize / 1024).toFixed(1)} KB)`);
  console.log(`Part index: ${path.relative(PROJECT_ROOT, result.partIndexPath)} (${(result.partIndexSize / 1024).toFixed(1)} KB)`);
  console.log(`Compat bundle: ${path.relative(PROJECT_ROOT, result.fullBundlePath)} (${(result.fullBundleSize / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`System chunks: ${path.relative(PROJECT_ROOT, result.chunkDir)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  writeCatalogBundles,
};

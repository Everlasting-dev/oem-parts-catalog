"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const INPUT = path.join(ROOT, "data", "diagram-sheet-composite.png");
const OUTPUT_DIR = path.join(ROOT, "data", "diagram-sheet-composite-view");
const TILE_HEIGHT = 2800;

async function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Missing composite PNG: ${INPUT}`);
  }

  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const image = sharp(INPUT);
  const meta = await image.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) {
    throw new Error("Could not read image dimensions");
  }

  const sliceCount = Math.ceil(height / TILE_HEIGHT);
  const sliceFiles = [];

  for (let i = 0; i < sliceCount; i += 1) {
    const top = i * TILE_HEIGHT;
    const sliceHeight = Math.min(TILE_HEIGHT, height - top);
    const fileName = `slice-${String(i + 1).padStart(2, "0")}.jpg`;
    const outPath = path.join(OUTPUT_DIR, fileName);

    await image
      .clone()
      .extract({ left: 0, top, width, height: sliceHeight })
      .jpeg({ quality: 92, mozjpeg: true })
      .toFile(outPath);

    sliceFiles.push(fileName);
    process.stdout.write(`\r  wrote ${i + 1}/${sliceCount}`.padEnd(24));
  }
  process.stdout.write("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Diagram Sheet Viewer</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #dceeff;
      --panel: #f8fbff;
      --line: #b7d1ea;
      --text: #15324d;
      --muted: #577896;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      background:
        linear-gradient(180deg, #edf6ff 0%, #dceeff 100%);
      color: var(--text);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      padding: 16px 22px;
      border-bottom: 1px solid var(--line);
      background: rgba(248, 251, 255, 0.94);
      backdrop-filter: blur(8px);
    }
    h1 {
      margin: 0;
      font-size: 22px;
    }
    p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .open-link {
      color: #0b62c4;
      text-decoration: none;
      font-weight: 600;
    }
    main {
      width: min(98vw, ${width + 64}px);
      margin: 0 auto;
      padding: 18px 0 32px;
    }
    .slice {
      display: block;
      width: 100%;
      height: auto;
      background: white;
      border: 1px solid var(--line);
      box-shadow: 0 10px 30px rgba(37, 84, 132, 0.08);
    }
    .slice + .slice {
      margin-top: 18px;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Diagram Sheet Viewer</h1>
      <p>${width} x ${height}px split into ${sliceCount} browser-friendly slices.</p>
    </div>
    <a class="open-link" href="../diagram-sheet-composite.png">Open original PNG</a>
  </header>
  <main>
    ${sliceFiles.map((file) => `<img class="slice" src="./${file}" alt="${file}" loading="lazy" />`).join("\n    ")}
  </main>
</body>
</html>
`;

  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), html, "utf8");
  console.log(`Created viewer: ${path.join(OUTPUT_DIR, "index.html")}`);
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});

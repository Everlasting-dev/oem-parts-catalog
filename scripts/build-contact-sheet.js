"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const IMG_EXT = new Set([".png", ".gif", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);

function parseIntArg(value, fallback) {
  const n = Number.parseInt(value || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function listImages(dir) {
  return fs.readdirSync(dir)
    .filter((name) => IMG_EXT.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(dir, name));
}

async function loadTile(fullPath, maxWidth, maxHeight) {
  const input = sharp(fullPath, { animated: false });
  const meta = await input.metadata();
  const width = meta.width || maxWidth;
  const height = meta.height || maxHeight;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));
  const buffer = await input
    .resize({
      width: resizedWidth,
      height: resizedHeight,
      fit: "inside",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();

  return {
    buffer,
    width: resizedWidth,
    height: resizedHeight,
    name: path.basename(fullPath),
  };
}

async function main() {
  const inputDir = path.resolve(process.argv[2] || path.join(ROOT, "data", "diagram-sheet-extract"));
  const outputPath = path.resolve(process.argv[3] || path.join(ROOT, "data", "diagram-sheet-composite.png"));
  const columns = parseIntArg(process.argv[4], 4);
  const tileWidth = parseIntArg(process.argv[5], 1200);
  const tileHeight = parseIntArg(process.argv[6], 900);
  const gap = parseIntArg(process.argv[7], 20);
  const padding = parseIntArg(process.argv[8], 32);

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input folder not found: ${inputDir}`);
  }

  const files = listImages(inputDir);
  if (files.length === 0) {
    throw new Error(`No images found in: ${inputDir}`);
  }

  console.log(`Loading ${files.length} image(s) from ${inputDir}`);
  const tiles = [];
  for (let i = 0; i < files.length; i += 1) {
    tiles.push(await loadTile(files[i], tileWidth, tileHeight));
    process.stdout.write(`\r  prepared ${i + 1}/${files.length}`.padEnd(32));
  }
  process.stdout.write("\n");

  const rows = Math.ceil(tiles.length / columns);
  const canvasWidth = padding * 2 + columns * tileWidth + (columns - 1) * gap;
  const canvasHeight = padding * 2 + rows * tileHeight + (rows - 1) * gap;

  const composites = [];
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index];
    const row = Math.floor(index / columns);
    const column = index % columns;
    const cellLeft = padding + column * (tileWidth + gap);
    const cellTop = padding + row * (tileHeight + gap);
    composites.push({
      input: tile.buffer,
      left: cellLeft + Math.round((tileWidth - tile.width) / 2),
      top: cellTop + Math.round((tileHeight - tile.height) / 2),
    });
  }

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  console.log(`Created ${outputPath}`);
  console.log(`Canvas: ${canvasWidth}x${canvasHeight}px`);
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exit(1);
});

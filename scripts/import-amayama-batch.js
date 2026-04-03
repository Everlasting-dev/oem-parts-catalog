'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PARSER_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'parse-amayama-html.js');

function parseArgs(argv) {
  const options = {
    input: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') && !options.input) {
      options.input = arg.trim();
    }
  }

  if (!options.input) {
    console.error('Usage: node scripts/import-amayama-batch.js <manifest-or-directory>');
    process.exit(1);
  }

  return options;
}

function resolveHtmlFiles(inputPath) {
  const fullPath = path.resolve(PROJECT_ROOT, inputPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }

  if (fs.statSync(fullPath).isDirectory()) {
    return fs.readdirSync(fullPath)
      .filter(name => name.endsWith('.html') && name !== '000-root.html')
      .map(name => path.join(fullPath, name))
      .sort();
  }

  if (path.basename(fullPath).toLowerCase() === 'manifest.json') {
    const manifest = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return (manifest.pages || [])
      .map(page => path.resolve(PROJECT_ROOT, page.file))
      .filter(filePath => fs.existsSync(filePath));
  }

  console.error('Input must be a directory or manifest.json');
  process.exit(1);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const htmlFiles = resolveHtmlFiles(options.input);

  if (htmlFiles.length === 0) {
    console.log('No HTML pages found to import.');
    return;
  }

  for (let index = 0; index < htmlFiles.length; index += 1) {
    const htmlFile = htmlFiles[index];
    console.log(`[${index + 1}/${htmlFiles.length}] importing ${path.basename(htmlFile)}`);
    execFileSync(process.execPath, [PARSER_SCRIPT, htmlFile], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
  }
}

main();

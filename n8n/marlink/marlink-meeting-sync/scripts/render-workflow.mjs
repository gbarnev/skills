#!/usr/bin/env node
// Render a workflow template into n8n Workflow SDK code that validate_workflow accepts.
//
//   node render-workflow.mjs <template.workflow.js> <config.json> [out.sdk.js]
//
// - `jsCode: file('../code/x.js')` is replaced by the file's contents as one string literal
//   (the SDK validator rejects `[...].join()` and spread syntax in workflow code).
// - A whole string literal '__KEY__' becomes JSON.stringify(config.KEY).
// - A bare __KEY__ (e.g. inside a URL or expression) becomes the raw string value,
//   or JSON for non-strings (arrays, numbers).
// Fails if a placeholder has no config value or if any placeholder is left over.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function fill(text, config, source) {
  const value = (key) => {
    if (!(key in config)) throw new Error(`${source}: config is missing "${key}"`);
    return config[key];
  };
  return text
    .replace(/(['"])__([A-Z0-9_]+)__\1/g, (_, quote, key) => JSON.stringify(value(key)))
    .replace(/__([A-Z0-9_]+)__/g, (_, key) => {
      const v = value(key);
      return typeof v === 'string' ? v : JSON.stringify(v);
    });
}

export function render(templatePath, config) {
  const dir = path.dirname(templatePath);
  const template = fs.readFileSync(templatePath, 'utf8');
  const withCode = template.replace(/jsCode:\s*file\((['"])(.+?)\1\)/g, (_, quote, relative) => {
    const codePath = path.resolve(dir, relative);
    return 'jsCode: ' + JSON.stringify(fill(fs.readFileSync(codePath, 'utf8').trimEnd(), config, relative));
  });
  const sdk = fill(withCode, config, path.basename(templatePath));
  const leftover = sdk.match(/__[A-Z0-9_]+__/);
  if (leftover) throw new Error(`unfilled placeholder ${leftover[0]}`);
  return sdk;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [templatePath, configPath, outPath] = process.argv.slice(2);
  if (!templatePath || !configPath) {
    console.error('usage: node render-workflow.mjs <template.workflow.js> <config.json> [out.sdk.js]');
    process.exit(1);
  }
  const sdk = render(templatePath, JSON.parse(fs.readFileSync(configPath, 'utf8')));
  if (outPath) {
    fs.writeFileSync(outPath, sdk);
    console.error(`wrote ${outPath} (${sdk.length} bytes)`);
  } else {
    process.stdout.write(sdk);
  }
}

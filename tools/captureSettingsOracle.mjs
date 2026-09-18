#!/usr/bin/env node
// Records which settings-schema descriptions the model actually reads.
//
// Runs a PRISTINE Claude Code against the loopback capture server with
// `/update-config`, whose prompt carries the whole settings JSON schema, and
// writes every description in that schema to
// data/settings-descriptions/oracle-<version>.json. The binary must be
// unpatched: a patched one carries edited overrides, and the oracle would
// record the edits instead of the schema.
//
//   node tools/captureSettingsOracle.mjs --binary <pristine claude> [--out <file>]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { captureRow, isPatched } from './liveness/capture.mjs';
import { buildProjection } from './liveness/projection.mjs';
import { UPDATE_CONFIG_ROW_ID, findRow } from './liveness/selectors.mjs';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const binary = flag('--binary');
if (!binary || !fs.existsSync(binary)) {
  console.error(
    'usage: captureSettingsOracle.mjs --binary <pristine claude binary> [--out <file>]'
  );
  process.exit(2);
}
if (isPatched(binary)) {
  console.error(
    `${binary} carries a tweakcc patch marker; pass the pristine binary (the native-binary.backup in the tweakcc config folder)`
  );
  process.exit(2);
}
const version = (execFileSync(binary, ['--version'], {
  encoding: 'utf8',
}).match(/\d+\.\d+\.\d+/) || [])[0];
if (!version) {
  console.error(`could not read the version of ${binary}`);
  process.exit(2);
}

const captured = await captureRow(findRow(UPDATE_CONFIG_ROW_ID), { binary });
const text = buildProjection(captured.body).messages.join('\n');
const heading = text.indexOf('## Full Settings JSON Schema');
const open = heading >= 0 ? text.indexOf('{', heading) : -1;
if (open < 0) {
  console.error('the captured /update-config prompt has no settings schema');
  process.exit(1);
}
// The schema is followed by a closing code fence; take the longest prefix that
// parses as JSON.
const fence = text.indexOf('\n```', open);
const schema = JSON.parse(text.slice(open, fence < 0 ? undefined : fence));

const descriptions = new Set();
const walk = node => {
  if (Array.isArray(node)) return node.forEach(walk);
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'description' && typeof v === 'string') descriptions.add(v);
    else walk(v);
  }
};
walk(schema);

const out =
  flag('--out') ||
  path.join(
    import.meta.dirname,
    '..',
    'data',
    'settings-descriptions',
    `oracle-${version}.json`
  );
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  JSON.stringify(
    { ccVersion: version, descriptions: [...descriptions].sort() },
    null,
    2
  ) + '\n'
);
console.log(
  `settings oracle: ${descriptions.size} description(s) from CC ${version} -> ${out}`
);

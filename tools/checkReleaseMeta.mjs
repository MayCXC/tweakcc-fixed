#!/usr/bin/env node
// Release gate: on a tag build the tag must match the package version, and
// package.json `supportedClaudeCode` (the newest Claude Code version this
// release supports) must name the newest prompts file in data/prompts. Runs in the release workflows only: mid
// bump, the prompts commit lands before the release commit, so this would fail
// the pre-commit suite by design.
//
//   node tools/checkReleaseMeta.mjs [--root <repo>]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const root =
  rootIdx >= 0
    ? path.resolve(args[rootIdx + 1])
    : path.join(import.meta.dirname, '..');

const cmpVer = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);
const versions = fs
  .readdirSync(path.join(root, 'data/prompts'))
  .map(f => (f.match(/^prompts-(\d+\.\d+\.\d+)\.json$/) || [])[1])
  .filter(Boolean)
  .sort(cmpVer);
const newest = versions[versions.length - 1];

const errors = [];
if (!newest) errors.push('no data/prompts/prompts-X.Y.Z.json found');
else if (pkg.supportedClaudeCode !== newest)
  errors.push(
    `package.json supportedClaudeCode is ${JSON.stringify(pkg.supportedClaudeCode)}, but the newest prompts file is ${newest}`
  );

const ref = process.env.GITHUB_REF_NAME || '';
if (ref.startsWith('v') && pkg.version !== ref.slice(1))
  errors.push(`tag ${ref} does not match package.json version ${pkg.version}`);

if (errors.length) {
  for (const e of errors) console.error(`release meta: ${e}`);
  console.error(
    'Bump version and supportedClaudeCode in package.json in the release commit.'
  );
  process.exit(1);
}
console.log(
  `release meta: OK (version ${pkg.version}, supportedClaudeCode ${pkg.supportedClaudeCode}${ref ? `, ref ${ref}` : ''})`
);

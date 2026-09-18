#!/usr/bin/env node
// An override can keep a placeholder and silently drop the SANITIZER wrapped
// around it. CC 2.1.234 introduced `Oie(x)` (named ESCAPE_UNTRUSTED_TEXT_FN in
// our identifierMap): it HTML-escapes `<`/`>` and turns every control character
// into a numeric entity, so an attacker-controlled filename cannot close a
// `<system-reminder>` or inject newlines. An override written before the change
// interpolates `${ATTACHMENT_OBJECT.filename}` instead of
// `${ESCAPE_UNTRUSTED_TEXT_FN(ATTACHMENT_OBJECT.filename)}`. It applies clean,
// binds to a real variable, renders sensible text, and passes apply hygiene,
// the four zeros, checkTrimSlots (the token IS still present), auditMisbinds
// and the smoke — while handing the model unescaped untrusted text.
//
// Usage: node tools/checkEscaperWrappers.mjs [prompts-X.Y.Z.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  parseOverrideArgs,
  resolveOverrideSets,
  remindersDirsFor,
  printAuditedSets,
} = require('./lib/overrideSets.cjs');

const repo = path.resolve(import.meta.dirname, '..');

const parsed = parseOverrideArgs(process.argv.slice(2));
const sets = resolveOverrideSets(parsed, { fallback: 'applied' });
printAuditedSets(sets);

const newestJson = () =>
  fs
    .readdirSync(path.join(repo, 'data', 'prompts'))
    .filter(f => /^prompts-\d+\.\d+\.\d+\.json$/.test(f))
    .sort((a, b) => {
      const pa = a.match(/\d+/g).map(Number);
      const pb = b.match(/\d+/g).map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return 0;
    })
    .at(-1);

const jsonPath =
  parsed.rest[0] || path.join(repo, 'data', 'prompts', newestJson());
if (!fs.existsSync(jsonPath)) {
  console.error(`checkEscaperWrappers: no prompts JSON at ${jsonPath}`);
  process.exit(2);
}

const reconstruct = p => {
  const pieces = p.pieces || [];
  const ids = p.identifiers || [];
  const map = p.identifierMap || {};
  let out = '';
  for (let i = 0; i < pieces.length; i++) {
    out += pieces[i];
    if (i < ids.length) out += map[String(ids[i])] ?? `UNKNOWN_${ids[i]}`;
  }
  return out;
};

// A label is a sanitizer if its NAME says so. Keying on the name rather than on
// the specific function keeps this alive when Anthropic adds a second escaper.
const WRAPPER = /\$\{([A-Z0-9_]*(?:ESCAPE|SANITIZE)[A-Z0-9_]*)\(([^()]*)\)\}/g;

// A shadowed id is never iterated by applySystemPrompts — the reminder registry
// (or another override's `shadows:`) already spliced that cli.js region — so its
// `.md` cannot leak anything and flagging it is a false positive. Same shadow set
// the audit backlog uses.
const shadowed = new Set();
try {
  const src = fs.readFileSync(
    path.join(repo, 'src/patches/systemReminderOverrides.ts'),
    'utf8'
  );
  for (const m of src.matchAll(/shadows:\s*\[([^\]]*)\]/g))
    for (const q of m[1].matchAll(/'([^']+)'/g)) shadowed.add(q[1]);
} catch {
  /* patcher source not present; fall through */
}
// `system-reminders` is a SINGLE shared folder, not one per model, and it is
// where most prompt-level shadows actually live: the reminder registry declares
// only two in TS, while `opened-file-in-ide.md` and eight siblings declare
// theirs in runtime front-matter. Scanning only the per-model prompt sets misses
// them and reports a shadowed (inert) override as a live leak.
for (const abs of [...sets.map(s => s.dir), ...remindersDirsFor(sets)]) {
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('.md')) continue;
    const head = fs.readFileSync(path.join(abs, f), 'utf8').split('-->')[0];
    const m = head.match(/^shadows:\s*\n((?:\s*-\s*\S+\n)+)/m);
    if (m) for (const q of m[1].matchAll(/-\s*(\S+)/g)) shadowed.add(q[1]);
  }
}

const prompts = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).prompts;
const findings = [];
let checked = 0;

for (const p of prompts) {
  if (!p.id || shadowed.has(p.id)) continue;
  const body = reconstruct(p);
  const wrapped = [...body.matchAll(WRAPPER)].map(m => ({
    fn: m[1],
    inner: m[2],
  }));
  if (!wrapped.length) continue;
  for (const set of sets) {
    const file = path.join(set.dir, `${p.id}.md`);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // An empty-bodied (suppressed) override renders nothing, so it cannot leak.
    const body_ = text.replace(/^<!--[\s\S]*?-->\n?/, '').trim();
    if (!body_) continue;
    checked++;
    for (const { fn, inner } of wrapped) {
      if (text.includes(`\${${fn}(${inner})}`)) continue;
      if (text.includes(`\${${inner}}`)) {
        findings.push({ set: set.name, id: p.id, fn, inner });
      }
    }
  }
}

console.log(
  `escaper wrappers: ${checked} override body/bodies over ${sets.length} set(s) checked`
);
if (findings.length === 0) {
  console.log('escaper wrappers: 0 dropped — PASS');
  process.exit(0);
}
console.log(`escaper wrappers: ${findings.length} DROPPED`);
for (const f of findings) {
  console.log(`  ${f.set}/${f.id}.md`);
  console.log(
    `    uses \${${f.inner}} where pristine has \${${f.fn}(${f.inner})}`
  );
}
console.log(
  'escaper wrappers: FAIL — the override hands the model unescaped untrusted text.'
);
process.exit(1);

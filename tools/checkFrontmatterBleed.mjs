#!/usr/bin/env node
// An override body must not carry an UNBALANCED HTML-comment closer.
//
// Front-matter is an HTML comment (`<!-- … -->`), and the body is everything
// after it. A bad edit can leave a second, orphan `-->` behind in the body —
// on CC 2.1.241 a stage-2 trim did exactly that to
// `system-prompts-opus-4-7/tool-result-read-large-file-requirements.md`, and
// that `-->` would have been spliced verbatim into cli.js as model-facing text.
//
// Nothing else in the stack sees it: the file parses as front-matter + body,
// applySafetyHarness introduces no `${var}`, the apply reports no warning, and
// a body-non-empty structural check passes. Only reading the body's comment
// balance catches it.
//
// The gate must be BALANCE-based, never "does the body contain `-->`". 96 of
// the corpus's bodies legitimately contain one: the artifact HTML templates'
// `<!-- SLOT: … -->` markers, the `<!-- dataviz-callout -->` injection
// sentinel, mermaid `a-->b` arrows in fenced diagrams. Flagging those would
// make the gate noise and it would be ignored.
//
//   node tools/checkFrontmatterBleed.mjs [--set=<dir>…]
//
// Default: the applied folder / TWEAKCC_OVERRIDE_SETS / --overrides.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseOverrideArgs, resolveOverrideSets, printAuditedSets } =
  require('./lib/overrideSets.cjs');

const parsed = parseOverrideArgs(process.argv.slice(2));
const sets = resolveOverrideSets(parsed, { fallback: 'applied' });

const FRONTMATTER = /^<!--[\s\S]*?-->\n?/;
// An orphan closer stands alone on its line. `a-->b` inside a mermaid fence and
// `\`<!-- SLOT: x -->\`` inline are balanced or inline, and neither matches.
const ORPHAN_LINE = /^\s*-->\s*$/m;

const findings = [];
let scanned = 0;

for (const set of sets) {
  if (!fs.existsSync(set.dir)) continue;
  for (const name of fs.readdirSync(set.dir)) {
    if (!name.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(set.dir, name), 'utf8');
    const m = text.match(FRONTMATTER);
    const body = m ? text.slice(m[0].length) : text;
    scanned += 1;
    const opens = (body.match(/<!--/g) || []).length;
    const closes = (body.match(/-->/g) || []).length;
    if (closes > opens && ORPHAN_LINE.test(body)) {
      findings.push({
        set: set.name,
        id: name.slice(0, -3),
        opens,
        closes,
      });
    }
  }
}

for (const f of findings) {
  console.log(
    `  ${f.set}  ${f.id}  (body has ${f.closes} "-->" against ${f.opens} "<!--")`
  );
}
printAuditedSets(sets);
console.log(
  `frontmatter bleed: ${findings.length} unbalanced comment closer(s) across ${scanned} override(s) in ${sets.length} set(s)`
);
if (findings.length) {
  console.log(
    'frontmatter bleed: FAIL — an orphan "-->" in a body is spliced into cli.js as model-facing text'
  );
  process.exit(1);
}
console.log('frontmatter bleed: PASS');

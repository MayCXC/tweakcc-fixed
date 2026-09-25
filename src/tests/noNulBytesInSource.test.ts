import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// A literal NUL byte in a source file is functionally invisible in JS (a raw NUL
// inside a string literal and the `\x00` escape produce the same string), but it
// makes the whole FILE look binary to every NUL-heuristic tool. That matters here
// specifically: Claude Code's own shell shim routes `grep` to ugrep with `-I`
// (skip binary files) — `FKi("grep","ugrep",["-G","--ignore-files","--hidden","-I",…])`
// in the bundle — so ONE stray NUL makes `grep PATTERN thatfile` return NOTHING for
// EVERY pattern, exit 1, with no warning. It reads as "clean / not present".
//
// Found the expensive way on 2026-07-16: tools/promptExtractor.js line 3632 had a
// literal NUL in `.join('<NUL>')` instead of `.join('\x00')`. The file had been
// silently ungreppable inside Claude Code — two separate searches during the CC
// 2.1.211 bump came back falsely empty and nearly caused real work to be skipped.
// Keep source ASCII/UTF-8 text-clean; write NUL as the `\x00` escape.
// `data` and `.claude/skills` are in scope for the same reason src and tools
// are, and the case for them is stronger: the showtime driver and the skill
// files are read almost exclusively BY an agent working inside Claude Code, so
// one NUL there makes the very file that documents the pipeline silently
// ungreppable. Added 2026-08-16 after three stray NULs landed in a new
// tools/ file — they could as easily have landed in the driver, which nothing
// would have caught.
const ROOTS = ['src', 'tools', 'data', '.claude/skills', 'skills'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'target',
  // Agent/Workflow isolation checks out repo copies here; their scratch files
  // are not ours to police and would double every scan.
  'worktrees',
]);
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (EXTS.has(path.extname(e.name))) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

describe('source files are text-clean (no literal NUL bytes)', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const files = ROOTS.flatMap(r => {
    const d = path.join(repoRoot, r);
    return fs.existsSync(d) ? walk(d) : [];
  });

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  // Reads every source file, so the wall time scales with the tree and the disk
  // beneath it; on a network filesystem under the parallel suite it passes
  // 5 seconds, which is the runner's default cap.
  it('no source file contains a raw NUL byte (use the \\x00 escape)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const buf = fs.readFileSync(f);
      const idx = buf.indexOf(0);
      if (idx !== -1) {
        const line = buf.subarray(0, idx).toString('utf8').split('\n').length;
        offenders.push(`${path.relative(repoRoot, f)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000);
});

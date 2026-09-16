#!/usr/bin/env node
// Run a gate command and FAIL when it produced no verdict.
//
// CC 2.1.273: `pnpm test:matcher` died immediately after vitest's `RUN` banner
// under every pool mode (threads, forks, single-thread, 8 GB heap), with the
// real bundle present and nothing else on the machine — no test output, no
// summary, and an exit code of 0 from the pipeline around it. An empty log is
// indistinguishable from a vacuous pass, which is the one thing a gate must
// never be: the showtime bar reads "exit 0" as green. The differential itself
// was fine (7,925/7,925, 0 mismatches) when the same logic was run directly.
//
// So the wrapper asserts the gate SPOKE, not merely that it exited: vitest must
// emit its "Test Files"/"Tests" summary. Anything else exits 2 and says the
// output was empty, which is the truthful report.
import { spawn } from 'node:child_process';

const [, , ...cmd] = process.argv;
if (!cmd.length) {
  console.error('runGate: usage: runGate.mjs <command> [args…]');
  process.exit(2);
}

let out = '';
const child = spawn(cmd[0], cmd.slice(1), { shell: false, env: process.env });
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', chunk => {
    out += chunk;
    process.stdout.write(chunk);
  });
}

child.on('close', (code, signal) => {
  const spoke = /Test Files\s+\d|Tests\s+\d|no test files found/i.test(out);
  if (!spoke) {
    console.error(
      `\nrunGate: ${cmd.join(' ')} produced no test summary` +
        (signal ? ` (killed by ${signal})` : ` (exit ${code})`) +
        '.\nA gate that did not report is a gate that did not run — treating it as FAILED.'
    );
    process.exit(2);
  }
  process.exit(code ?? 1);
});

child.on('error', err => {
  console.error(`runGate: could not start ${cmd[0]}: ${err.message}`);
  process.exit(2);
});

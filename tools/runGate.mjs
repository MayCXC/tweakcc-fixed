#!/usr/bin/env node
// Run a gate command and FAIL when it produced no verdict.
//
// The invariant: a gate that did not REPORT must not read as a gate that found
// nothing. `pnpm test:matcher` takes ~11 minutes against a 35MB bundle and
// vitest prints nothing until a test settles, so a run that is killed part-way
// — by a harness timeout, a competing invocation, a pre-commit hook — leaves a
// log holding only the `RUN` banner while the surrounding pipeline still sees
// exit 0. On CC 2.1.273 that happened four times and was written up as "the
// gate is broken"; the gate was passing the whole time (7,925/7,925, 0
// mismatches), and the real defect was that a working run and a dead one were
// indistinguishable from outside.
//
// Two fixes, and this is the backstop half: the corpus test now streams
// progress so a long run is observably alive, and this wrapper asserts vitest
// actually emitted its summary. Anything else exits 2 naming the signal, which
// is the truthful report.
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

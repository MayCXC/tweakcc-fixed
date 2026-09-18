import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOL = path.join(import.meta.dirname, 'checkReleaseMeta.mjs');

const run = (pkg, promptVersions, ref) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasemeta-'));
  fs.mkdirSync(path.join(dir, 'data/prompts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  for (const v of promptVersions)
    fs.writeFileSync(path.join(dir, `data/prompts/prompts-${v}.json`), '{}');
  const env = { ...process.env, GITHUB_REF_NAME: ref ?? '' };
  const r = spawnSync('node', [TOOL, '--root', dir], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout + r.stderr };
};

describe('checkReleaseMeta', () => {
  it('passes when the field names the newest prompts file', () => {
    const r = run({ version: '1.0.0', supportedClaudeCode: '2.1.100' }, [
      '2.1.99',
      '2.1.100',
    ]);
    expect(r.code).toBe(0);
  });

  it('compares versions numerically, not lexically', () => {
    const r = run({ version: '1.0.0', supportedClaudeCode: '2.1.99' }, [
      '2.1.99',
      '2.1.100',
    ]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('newest prompts file is 2.1.100');
  });

  it('checks only the tag while package.json declares no field', () => {
    expect(run({ version: '1.0.0' }, ['2.1.100']).code).toBe(0);
    expect(run({ version: '1.0.0' }, ['2.1.100'], 'v1.0.1').code).toBe(1);
  });

  it('checks the tag against the package version', () => {
    const pkg = { version: '1.0.0', supportedClaudeCode: '2.1.100' };
    expect(run(pkg, ['2.1.100'], 'v1.0.0').code).toBe(0);
    const bad = run(pkg, ['2.1.100'], 'v1.0.1');
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('tag v1.0.1');
  });

  it('ignores a non-tag ref', () => {
    const r = run(
      { version: '1.0.0', supportedClaudeCode: '2.1.100' },
      ['2.1.100'],
      'main'
    );
    expect(r.code).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const cache = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, '..', 'data', 'prompt-classification.json'),
    'utf8'
  )
);

describe('prompt-classification.json', () => {
  it('keys every row by a full sha1, or the row can never bind', () => {
    const bad = Object.keys(cache).filter(k => !/^[0-9a-f]{40}$/.test(k));
    expect(bad).toEqual([]);
  });

  it('gives every row a known facing', () => {
    const bad = Object.entries(cache)
      .filter(([, v]) => !['model', 'internal', 'ui'].includes(v.facing))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

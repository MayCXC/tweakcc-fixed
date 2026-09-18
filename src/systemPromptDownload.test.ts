import { describe, it, expect } from 'vitest';
import { latestPromptsVersion } from './systemPromptDownload';

describe('latestPromptsVersion', () => {
  it('picks the newest version among prompts filenames', () => {
    expect(
      latestPromptsVersion([
        'prompts-2.1.267.json',
        'prompts-2.1.273.json',
        'prompts-2.1.270.json',
      ])
    ).toBe('2.1.273');
  });

  it('orders numerically so 2.1.10 beats 2.1.9', () => {
    // A plain lexicographic sort would rank "2.1.9" above "2.1.10".
    expect(
      latestPromptsVersion(['prompts-2.1.9.json', 'prompts-2.1.10.json'])
    ).toBe('2.1.10');
  });

  it('ignores names that are not prompts-X.Y.Z.json', () => {
    expect(
      latestPromptsVersion([
        'README.md',
        '.gitkeep',
        'prompts-old.json',
        'prompts-2.0.30.json',
      ])
    ).toBe('2.0.30');
  });

  it('returns null when no name matches', () => {
    expect(latestPromptsVersion([])).toBeNull();
    expect(
      latestPromptsVersion(['README.md', '.gitkeep', 'prompts-old.json'])
    ).toBeNull();
  });
});

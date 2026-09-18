import { describe, it, expect, vi } from 'vitest';
import {
  latestPromptsVersion,
  resolveFetchVersion,
} from './systemPromptDownload';

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

describe('resolveFetchVersion', () => {
  it('takes an explicit version over everything else', () => {
    expect(resolveFetchVersion('2.1.200', '2.1.276', () => '2.1.277')).toBe(
      '2.1.200'
    );
  });

  it('prefers the declared version over newer prompt data on disk', () => {
    // The state of a checkout between a prompts commit and the release that
    // can patch what it describes. Answering 2.1.277 here would name a version
    // this build has no patch code for.
    expect(resolveFetchVersion(undefined, '2.1.276', () => '2.1.277')).toBe(
      '2.1.276'
    );
  });

  it('falls back to prompt data when nothing is declared', () => {
    expect(resolveFetchVersion(undefined, undefined, () => '2.1.273')).toBe(
      '2.1.273'
    );
  });

  it('returns null when no source can name a version', () => {
    expect(resolveFetchVersion(undefined, undefined, () => null)).toBeNull();
  });

  it('does not read the directory unless it reaches that source', () => {
    const localNewest = vi.fn(() => '2.1.273');
    resolveFetchVersion('2.1.200', '2.1.276', localNewest);
    resolveFetchVersion(undefined, '2.1.276', localNewest);
    expect(localNewest).not.toHaveBeenCalled();

    resolveFetchVersion(undefined, undefined, localNewest);
    expect(localNewest).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  latestPromptsVersion,
  resolveFetchVersion,
} from './systemPromptDownload';
import { TWEAKCC_VERSION, TWEAKCC_SUPPORTED_CC } from './packageMeta';

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

describe('downloadStringsFile ref selection', () => {
  // A version no release carries, so the repo-local read above it misses and
  // the network path is what these exercise. A real version would be answered
  // from data/prompts/ and never reach a URL.
  const ABSENT = '2.0.0';
  const NEWER = '99.99.99';
  const realFetch = globalThis.fetch;

  // A successful fetch writes the prompts JSON to the cache beside the user's
  // config, and PROMPT_CACHE_DIR is resolved when the module loads. So the
  // module is reloaded per test under a temp TWEAKCC_CONFIG_DIR: without it
  // the first test seeds a cache for ABSENT in the developer's real config
  // directory, and the later ones are served from it instead of reaching the
  // code under test.
  const load = async (): Promise<typeof import('./systemPromptDownload')> => {
    process.env.TWEAKCC_CONFIG_DIR = mkdtempSync(
      path.join(tmpdir(), 'tweakcc-prompt-cache-')
    );
    vi.resetModules();
    return import('./systemPromptDownload');
  };

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.TWEAKCC_CONFIG_DIR;
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  const spyFetch = (reply: (n: number) => Response): { calls: string[] } => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      calls.push(String(input));
      return Promise.resolve(reply(calls.length));
    }) as unknown as typeof fetch;
    return { calls };
  };

  const ok = (): Response =>
    new Response(JSON.stringify({ prompts: [] }), { status: 200 });

  const cacheRoot = (): string =>
    path.join(process.env.TWEAKCC_CONFIG_DIR as string, 'prompt-data-cache');

  const cacheFile = (version: string): string =>
    path.join(cacheRoot(), `v${TWEAKCC_VERSION}`, `prompts-${version}.json`);

  it('reads the prompts JSON from this release tag', async () => {
    const { downloadStringsFile } = await load();
    const { calls } = spyFetch(() => ok());

    await downloadStringsFile(ABSENT);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`/refs/tags/v${TWEAKCC_VERSION}/`);
    expect(calls[0]).toContain(`prompts-${ABSENT}.json`);
  });

  it('fetches an older requested Claude Code version', async () => {
    const { downloadStringsFile } = await load();
    const { calls } = spyFetch(() => ok());

    await expect(downloadStringsFile(ABSENT)).resolves.toEqual({ prompts: [] });

    expect(calls).toHaveLength(1);
  });

  it('uses repo-local prompts before checking the supported version', async () => {
    const localPath = path.join(
      process.cwd(),
      'data',
      'prompts',
      `prompts-${NEWER}.json`
    );
    vi.doMock('node:fs/promises', async importOriginal => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        readFile: (
          filePath: Parameters<typeof actual.readFile>[0],
          options: Parameters<typeof actual.readFile>[1]
        ) =>
          String(filePath) === localPath
            ? Promise.resolve(JSON.stringify({ prompts: [] }))
            : actual.readFile(filePath, options),
      };
    });
    const { downloadStringsFile, findRepoPromptsDir } = await load();
    expect(findRepoPromptsDir()).not.toBeNull();
    const { calls } = spyFetch(() => ok());

    await expect(downloadStringsFile(NEWER)).resolves.toEqual({ prompts: [] });

    expect(calls).toHaveLength(0);
  });

  it('rejects a newer requested version before cache or fetch', async () => {
    const { downloadStringsFile } = await load();
    const { calls } = spyFetch(() => ok());
    mkdirSync(path.dirname(cacheFile(NEWER)), { recursive: true });
    writeFileSync(cacheFile(NEWER), JSON.stringify({ prompts: [] }));

    await expect(downloadStringsFile(NEWER)).rejects.toThrow(
      `tweakcc-fixed ${TWEAKCC_VERSION} carries prompts through Claude Code ${TWEAKCC_SUPPORTED_CC}, and ${NEWER} is newer. Run \`npx -y tweakcc-fixed@latest --apply\``
    );

    expect(calls).toHaveLength(0);
  });

  it('serves the second read from the cache without fetching', async () => {
    const { downloadStringsFile } = await load();
    const { calls } = spyFetch(() => ok());

    await downloadStringsFile(ABSENT);
    await downloadStringsFile(ABSENT);

    expect(calls).toHaveLength(1);
  });

  it('keys the cache by release and drops what other releases left', async () => {
    const { downloadStringsFile } = await load();
    spyFetch(() => ok());
    const root = cacheRoot();
    // Both shapes a past install can leave: another release's directory, and a
    // loose file from before the key carried one.
    mkdirSync(path.join(root, 'v0.0.1'), { recursive: true });
    writeFileSync(path.join(root, 'v0.0.1', 'prompts-1.0.0.json'), '{}');
    writeFileSync(path.join(root, `prompts-${ABSENT}.json`), '{}');

    await downloadStringsFile(ABSENT);

    expect(readdirSync(root)).toEqual([`v${TWEAKCC_VERSION}`]);
    expect(readdirSync(path.join(root, `v${TWEAKCC_VERSION}`))).toContain(
      `prompts-${ABSENT}.json`
    );
  });

  it('caches the new file even when an old entry cannot be removed', async () => {
    let cachedAtSweep = false;
    vi.doMock('node:fs/promises', async importOriginal => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        rm: (
          target: Parameters<typeof actual.rm>[0],
          options: Parameters<typeof actual.rm>[1]
        ) => {
          if (String(target).endsWith('/v0.0.1')) {
            cachedAtSweep = existsSync(cacheFile(ABSENT));
            return Promise.reject(new Error('EACCES'));
          }
          return actual.rm(target, options);
        },
      };
    });
    const { downloadStringsFile } = await load();
    spyFetch(() => ok());
    mkdirSync(path.join(cacheRoot(), 'v0.0.1'), { recursive: true });
    mkdirSync(path.join(cacheRoot(), 'v0.0.2'));

    await downloadStringsFile(ABSENT);

    expect(JSON.parse(readFileSync(cacheFile(ABSENT), 'utf-8'))).toEqual({
      prompts: [],
    });
    expect(cachedAtSweep).toBe(true);
    expect(readdirSync(cacheRoot())).toContain('v0.0.1');
    expect(readdirSync(cacheRoot())).not.toContain('v0.0.2');
  });

  it('leaves unrelated cache-root entries during the sweep', async () => {
    const { downloadStringsFile } = await load();
    spyFetch(() => ok());
    const root = cacheRoot();
    mkdirSync(path.join(root, 'notes'), { recursive: true });
    writeFileSync(path.join(root, 'notes', 'keep.txt'), 'keep');
    writeFileSync(path.join(root, 'keep.txt'), 'keep');
    mkdirSync(path.join(root, 'v0.0.1'));
    writeFileSync(path.join(root, 'prompts-1.0.0.json'), '{}');

    await downloadStringsFile(ABSENT);

    expect(readdirSync(root).sort()).toEqual(
      ['keep.txt', 'notes', `v${TWEAKCC_VERSION}`].sort()
    );
    expect(readFileSync(path.join(root, 'notes', 'keep.txt'), 'utf-8')).toBe(
      'keep'
    );
  });

  it('refetches and replaces a cached JSON object without prompts', async () => {
    const { downloadStringsFile } = await load();
    mkdirSync(path.dirname(cacheFile(ABSENT)), { recursive: true });
    writeFileSync(cacheFile(ABSENT), '{}');
    const { calls } = spyFetch(() => ok());

    await expect(downloadStringsFile(ABSENT)).resolves.toEqual({ prompts: [] });

    expect(calls).toHaveLength(1);
    expect(JSON.parse(readFileSync(cacheFile(ABSENT), 'utf-8'))).toEqual({
      prompts: [],
    });
  });

  it('names the release whose tag was searched when there is no such file', async () => {
    const { downloadStringsFile } = await load();
    spyFetch(() => new Response('', { status: 404 }));

    await expect(downloadStringsFile(ABSENT)).rejects.toThrow(
      `tweakcc-fixed v${TWEAKCC_VERSION}`
    );
  });
});

describe('preloadStringsFile version gate', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.TWEAKCC_CONFIG_DIR;
    vi.resetModules();
  });

  it('does not fetch for a Claude Code newer than the release supports', async () => {
    process.env.TWEAKCC_CONFIG_DIR = mkdtempSync(
      path.join(tmpdir(), 'tweakcc-prompt-cache-')
    );
    vi.resetModules();
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: string | URL | Request) => {
      calls.push(String(input));
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    const { preloadStringsFile } = await import('./systemPromptSync');
    const result = await preloadStringsFile('99.99.99');

    expect(calls).toHaveLength(0);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain(TWEAKCC_SUPPORTED_CC);
    expect(result.errorMessage).toContain('99.99.99');
  });
});

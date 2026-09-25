import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import type { StringsFile } from './systemPromptSync';
import { PROMPT_CACHE_DIR } from './config';
import { TWEAKCC_VERSION, TWEAKCC_SUPPORTED_CC } from './packageMeta';
import { readResponseTextCapped } from './utils';
import { compareVersions } from './versionCompare';

// Cap the prompts-JSON fetch so a hung / blackholed connection (captive portal,
// firewall sinkhole) falls back to the cache below instead of stalling --apply
// forever. The catch block already treats a timeout as a network failure and
// serves the cache, but without this cap that path was unreachable.
const PROMPTS_FETCH_TIMEOUT_MS = 20_000;

// Resolve the repo-local data/prompts/ directory by walking up from this
// module's location. Lets a fork that ships its own prompt JSONs (e.g.
// tweakcc-fixed shipping a same-day prompts-X.Y.Z.json before upstream
// publishes one) skip the network fetch when run via `node dist/index.mjs`.
// Published npm builds strip data/ via .npmignore, so this returns null
// for those installs and the network path takes over.
export function findRepoPromptsDir(): string | null {
  try {
    const here = fileURLToPath(import.meta.url);
    let dir = path.dirname(here);
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'data', 'prompts');
      const pkg = path.join(dir, 'package.json');
      if (fsSync.existsSync(pkg) && fsSync.existsSync(candidate)) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // import.meta.url unavailable in unusual runtimes
  }
  return null;
}

/**
 * Pick the newest version among a set of prompts filenames. Matches the repo's
 * prompts-file idiom (`prompts-X.Y.Z.json`), keeps each captured version, and
 * orders them with a numeric-aware locale compare so 2.1.10 sorts after 2.1.9
 * (a plain lexicographic sort would put 2.1.9 last).
 *
 * @param fileNames - Directory entry names to scan (order irrelevant)
 * @returns The newest "X.Y.Z" version, or null when none match
 */
export function latestPromptsVersion(fileNames: string[]): string | null {
  const versions = fileNames
    .map(name => /^prompts-(\d+\.\d+\.\d+)\.json$/.exec(name)?.[1])
    .filter((v): v is string => v !== undefined)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return versions.at(-1) ?? null;
}

/**
 * The newest Claude Code version the prompt data on disk covers, or null when
 * there is no data/prompts to read (a published npm install, whose tarball
 * ships none).
 *
 * This is the same resolution the repo's own tools use for their default
 * version argument (`arg('--json') ?? newestPromptsJson()` in
 * checkOutputContracts, and the equivalent in auditMisbinds,
 * auditCallSlots and checkEscaperWrappers): read the directory, keep the
 * `prompts-X.Y.Z.json` entries, take the numerically newest.
 */
export function newestLocalPromptsVersion(): string | null {
  const repoDir = findRepoPromptsDir();
  if (!repoDir) return null;
  try {
    return latestPromptsVersion(fsSync.readdirSync(repoDir));
  } catch {
    return null;
  }
}

/**
 * Which Claude Code version to fetch prompts for, in order of what each source
 * actually knows.
 *
 * An explicit argument is the caller's own decision and settles it.
 *
 * Otherwise the release's declared version wins, because the question a caller
 * asks with no argument is which Claude Code this build can patch, and that is
 * a fact about the patch code. Prompt data cannot answer it: the data and the
 * code move independently, a prompts commit landing before the release able to
 * patch what it describes, so the newest file on disk can name a version whose
 * shape this build does not match. Getting that wrong in the generous
 * direction is the costly one, since it installs a Claude Code that `--apply`
 * then fails on, while the cautious answer merely installs an older one that
 * works.
 *
 * The prompt data answers only when no declaration exists, which is a checkout
 * from before the field. A published install has neither and passes a version.
 *
 * @param localNewest Deferred, so the directory is read only when reached.
 */
export function resolveFetchVersion(
  requested: string | undefined,
  declared: string | undefined,
  localNewest: () => string | null
): string | null {
  return requested ?? declared ?? localNewest();
}

/**
 * Downloads the strings file for a given CC version from GitHub.
 *
 * Resolution order: repo-local data/prompts/ (when running from a checkout)
 * → user cache → network. Repo-local wins because a checkout's own JSON is
 * what its patch code was written against, while the cache holds whatever a
 * published release served. For npm-installed runs (no repo dir), the order is
 * cache → network.
 *
 * @param version - Version string in format "X.Y.Z" (e.g., "2.0.30")
 * @returns Promise that resolves to the parsed JSON content
 */
const isStringsFile = (value: unknown): value is StringsFile =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  'prompts' in value &&
  Array.isArray(value.prompts);

export async function downloadStringsFile(
  version: string
): Promise<StringsFile> {
  // Repo-local data/prompts wins when present (checked-out fork running
  // `node dist/...` should always use its own JSON, not whatever the user
  // happened to have cached from a prior network fetch).
  const repoDir = findRepoPromptsDir();
  if (repoDir) {
    const localPath = path.join(repoDir, `prompts-${version}.json`);
    try {
      const localContent = await fs.readFile(localPath, 'utf-8');
      return JSON.parse(localContent) as StringsFile;
    } catch {
      // Repo doesn't have this version - fall through to cache/network.
    }
  }

  if (
    TWEAKCC_SUPPORTED_CC &&
    compareVersions(version, TWEAKCC_SUPPORTED_CC) > 0
  ) {
    throw new Error(
      `tweakcc-fixed ${TWEAKCC_VERSION} carries prompts through Claude Code ${TWEAKCC_SUPPORTED_CC}, and ${version} is newer. Run \`npx -y tweakcc-fixed@latest --apply\` to pick up a release that covers it.`
    );
  }

  // User cache (npm-installed runs that have no repo dir), keyed by the package
  // version as well as the Claude Code one. Two releases can carry different
  // data for the same Claude Code version, so a key naming only that version
  // would let one release read what another cached. A directory per release
  // keeps them apart.
  const cacheDir = path.join(PROMPT_CACHE_DIR, `v${TWEAKCC_VERSION}`);
  const cacheFilePath = path.join(cacheDir, `prompts-${version}.json`);
  const readCache = async (): Promise<StringsFile | null> => {
    try {
      const parsed: unknown = JSON.parse(
        await fs.readFile(cacheFilePath, 'utf-8')
      );
      return isStringsFile(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  // The cache answers before the network. This release addresses its own tag,
  // whose bytes are fixed once published, so a cached file is the file a fetch
  // would return and the download buys nothing.
  const cached = await readCache();
  if (cached) return cached;

  // Construct the GitHub raw URL. This MUST point at the fork's own repo: the
  // npm tarball ships no data/, so npx installs resolve prompts JSONs from
  // here — upstream's JSONs use different naming conventions and would
  // silently mis-pair with this fork's overrides.
  //
  // The ref is this build's own release tag, so an npm install reads the bytes
  // committed when it was published — the same ones a clone at that tag reads
  // from disk above. `package.json` already names the release; addressing the
  // tag is what carries that to the data.
  const url = `https://raw.githubusercontent.com/skrabe/tweakcc-fixed/refs/tags/v${TWEAKCC_VERSION}/data/prompts/prompts-${version}.json`;

  try {
    // Fetch the file from GitHub
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROMPTS_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Provide specific error messages for common HTTP errors
      let errorMessage: string;
      if (response.status === 429) {
        errorMessage =
          'Rate limit exceeded. GitHub has temporarily blocked requests. Please wait a few minutes and try again.';
      } else if (response.status === 404) {
        errorMessage = `Prompts file not found for Claude Code v${version} in tweakcc-fixed v${TWEAKCC_VERSION}. That release carries the prompts published with it — check https://github.com/skrabe/tweakcc-fixed for a release covering this Claude Code.`;
      } else if (response.status >= 500) {
        errorMessage = `GitHub server error (${response.status}). Please try again later.`;
      } else {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }

      // Just throw the error - it will be caught and displayed by the caller
      throw new Error(errorMessage);
    }

    // Parse JSON (capped read — the prompts JSON is ~2 MB; the 32 MB default is
    // generous while preventing a runaway body from a compromised/transient host).
    const jsonData: unknown = JSON.parse(
      await readResponseTextCapped(response)
    );
    if (!isStringsFile(jsonData)) {
      throw new Error(
        `The prompts file for Claude Code ${version} has no prompts array`
      );
    }

    // Save to cache, and drop what other releases left behind: each release
    // reads only its own directory, so theirs can never be read again and the
    // cache would otherwise grow by one copy of the data per upgrade. This also
    // clears the loose `prompts-*.json` files written before the key carried a
    // release.
    const tempFilePath = path.join(
      cacheDir,
      `.prompts-${version}.${randomUUID()}.tmp`
    );
    let cacheWritten = false;
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(
        tempFilePath,
        JSON.stringify(jsonData, null, 2),
        'utf-8'
      );
      await fs.rename(tempFilePath, cacheFilePath);
      cacheWritten = true;
    } catch (cacheError) {
      await fs.rm(tempFilePath, { force: true }).catch(() => {});
      console.warn(
        `Failed to write to cache to ${cacheFilePath}: ${cacheError}`
      );
    }

    if (cacheWritten) {
      try {
        for (const entry of await fs.readdir(PROMPT_CACHE_DIR, {
          withFileTypes: true,
        })) {
          const oldRelease =
            entry.isDirectory() &&
            /^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(entry.name) &&
            entry.name !== `v${TWEAKCC_VERSION}`;
          const oldLooseFile =
            entry.isFile() && /^prompts-.+\.json$/.test(entry.name);
          if (!oldRelease && !oldLooseFile) continue;
          const entryPath = path.join(PROMPT_CACHE_DIR, entry.name);
          try {
            await fs.rm(entryPath, { recursive: oldRelease, force: true });
          } catch (cacheError) {
            console.warn(
              `Failed to remove cache entry ${entryPath}: ${cacheError}`
            );
          }
        }
      } catch (cacheError) {
        console.warn(
          `Failed to sweep cache ${PROMPT_CACHE_DIR}: ${cacheError}`
        );
      }
    }

    return jsonData;
  } catch (error) {
    if (error instanceof Error) {
      // If it's already our custom error with the message displayed, re-throw it
      if (
        error.message.includes('Rate limit') ||
        error.message.includes('not found') ||
        error.message.includes('server error') ||
        error.message.includes('HTTP')
      ) {
        throw error;
      }
      // Otherwise wrap it and throw
      const wrappedMessage = `Failed to download prompts for version ${version}: ${error.message}`;
      throw new Error(wrappedMessage);
    }
    throw error;
  }
}

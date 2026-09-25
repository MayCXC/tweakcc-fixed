import { getAllPatchDefinitions } from './patches/index';

export type PatchFilterResult =
  | { ok: true; filter: string[] | null }
  | { ok: false; error: string };

/**
 * Resolve and validate a comma-separated `--patches` argument against the known
 * patch IDs and the system prompt IDs of the Claude Code version being patched.
 *
 * The apply path matches the filter by inclusion, so an unknown ID (a typo)
 * would silently match nothing — the patch or prompt the caller meant to apply
 * is skipped with no warning. Agents drive `--patches` at showtime, so this
 * validates before anything is applied and fails instead.
 *
 * @param promptIds - The system prompt IDs of the version being patched. Empty
 *   when its prompts could not be loaded, which leaves only patch IDs valid.
 * @param shadowDeclarations - Overrides and the prompt IDs they own (`shadows:`).
 * @returns `{ filter }` with the cleaned IDs (or null = apply all), or an
 *   `{ error }` describing an unknown, shadowed, or empty filter.
 */
export function resolvePatchFilter(
  patchesArg: string | undefined | null,
  promptIds: Iterable<string> = [],
  shadowDeclarations: ReadonlyMap<string, ReadonlySet<string>> = new Map()
): PatchFilterResult {
  if (!patchesArg) return { ok: true, filter: null };

  const requested = patchesArg
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    return {
      ok: false,
      error:
        '--patches was provided but contained no patch or system prompt IDs.',
    };
  }

  const patchIdSet = new Set<string>(getAllPatchDefinitions().map(d => d.id));
  const promptIdSet = new Set(promptIds);
  const unknown = requested.filter(
    id => !patchIdSet.has(id) && !promptIdSet.has(id)
  );
  const shadowed = requested
    .filter(id => !patchIdSet.has(id) && promptIdSet.has(id))
    .flatMap(id => {
      const owners = [...shadowDeclarations]
        .filter(([, ids]) => ids.has(id))
        .map(([owner]) => (owner.endsWith('.md') ? owner.slice(0, -3) : owner));
      const uniqueOwners = [...new Set(owners)];
      if (uniqueOwners.length === 0) return [];
      const ownerDetails = uniqueOwners.map(owner =>
        promptIdSet.has(owner)
          ? `${owner} (pass --patches ${owner} instead)`
          : `${owner} (its override applies on every --apply)`
      );
      return [`${id} is shadowed by ${ownerDetails.join(', ')}`];
    });
  const errors = [];
  if (unknown.length > 0) {
    errors.push(
      `unknown patch or system prompt ID(s) in --patches: ${unknown.join(', ')}`
    );
  }
  if (shadowed.length > 0) {
    errors.push(`system prompt ID(s) in --patches: ${shadowed.join('; ')}`);
  }
  if (errors.length > 0) return { ok: false, error: errors.join('\n') };

  return { ok: true, filter: requested };
}

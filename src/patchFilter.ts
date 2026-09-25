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
 * @param shadowedIds - Prompt IDs an override declares it owns (`shadows:`).
 *   The apply path skips them without a result line, so naming one alone
 *   would apply nothing; they are rejected with that reason.
 * @returns `{ filter }` with the cleaned IDs (or null = apply all), or an
 *   `{ error }` describing an unknown, shadowed, or empty filter.
 */
export function resolvePatchFilter(
  patchesArg: string | undefined | null,
  promptIds: Iterable<string> = [],
  shadowedIds: ReadonlySet<string> = new Set()
): PatchFilterResult {
  if (!patchesArg) return { ok: true, filter: null };

  const requested = patchesArg
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    return {
      ok: false,
      error: '--patches was provided but contained no patch IDs.',
    };
  }

  const validIds = new Set<string>([
    ...getAllPatchDefinitions().map(d => d.id),
    ...promptIds,
  ]);
  const unknown = requested.filter(id => !validIds.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `unknown patch or system prompt ID(s) in --patches: ${unknown.join(', ')}`,
    };
  }

  const shadowed = requested.filter(id => shadowedIds.has(id));
  if (shadowed.length > 0) {
    return {
      ok: false,
      error: `system prompt ID(s) in --patches are shadowed by an override that owns their text, so they never apply on their own: ${shadowed.join(', ')}`,
    };
  }

  return { ok: true, filter: requested };
}

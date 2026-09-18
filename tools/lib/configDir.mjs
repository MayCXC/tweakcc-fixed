// The config directory the patcher uses, for the check tools.
//
// `src/config.ts` resolves this with getConfigDir() and derives SYSTEM_PROMPTS_DIR
// from it, but the tools are plain .mjs and cannot import the TypeScript source,
// so the resolution is mirrored here rather than each tool assuming ~/.tweakcc.
// A tool that assumes it audits nothing on the other three locations, and on a
// setup that uses one it fails on a missing directory instead of reporting.
//
// Keep in step with getConfigDir() in src/config.ts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const expandTilde = p =>
  p.startsWith('~/') || p === '~' ? path.join(os.homedir(), p.slice(1)) : p;

const exists = p => {
  try {
    return fs.existsSync(p);
  } catch {
    // Unreadable is not "here": fall through to the next candidate.
    return false;
  }
};

/**
 * Resolve the config directory, in the patcher's own order: TWEAKCC_CONFIG_DIR,
 * then ~/.tweakcc, then ~/.claude/tweakcc, then $XDG_CONFIG_HOME/tweakcc,
 * defaulting to ~/.tweakcc.
 */
export function getConfigDir() {
  const override = process.env.TWEAKCC_CONFIG_DIR?.trim();
  if (override) return expandTilde(override);

  const legacy = path.join(os.homedir(), '.tweakcc');
  if (exists(legacy)) return legacy;

  const claude = path.join(os.homedir(), '.claude', 'tweakcc');
  if (exists(claude)) return claude;

  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'tweakcc');

  return legacy;
}

/**
 * The system-prompts folder `--apply` reads. This is the only override location
 * the patcher consults, so it is what an audit should look at by default.
 * Returns the resolved target when it is a symlink, since that is the directory
 * whose files actually reach the binary.
 *
 * @returns the directory, or null when nothing is applied
 */
export function getAppliedSystemPromptsDir() {
  const dir = path.join(getConfigDir(), 'system-prompts');
  if (!exists(dir)) return null;
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

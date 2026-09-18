'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function expandTilde(filepath, home) {
  if (filepath.startsWith('~')) {
    return path.join(home, filepath.slice(1));
  }
  return filepath;
}

function defaultExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveConfigDir({
  env = process.env,
  home = os.homedir(),
  exists = defaultExists,
} = {}) {
  const tweakccConfigDir = (env.TWEAKCC_CONFIG_DIR ?? '').trim();
  if (tweakccConfigDir && tweakccConfigDir.length > 0) {
    return expandTilde(tweakccConfigDir, home);
  }
  const defaultDir = path.join(home, '.tweakcc');
  const claudeDir = path.join(home, '.claude', 'tweakcc');
  if (exists(defaultDir)) return defaultDir;
  if (exists(claudeDir)) return claudeDir;
  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, 'tweakcc');
  }
  return defaultDir;
}

function appliedPromptsDir(opts) {
  return path.join(resolveConfigDir(opts), 'system-prompts');
}

function appliedRemindersDir(opts) {
  return path.join(resolveConfigDir(opts), 'system-reminders');
}

function pristineCliPath(opts) {
  return path.join(resolveConfigDir(opts), 'native-claudejs-orig.js');
}

function parseOverrideArgs(argv) {
  const explicit = [];
  const lcc = [];
  const rest = [];
  let requireSets = false;
  let specified = false;
  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--require-sets') {
      requireSets = true;
      continue;
    }
    if (a === '--overrides' || a === '--lcc') {
      specified = true;
      const dir = args[++i];
      if (a === '--lcc') {
        console.error(
          'warning: --lcc is deprecated; pass --overrides <set-dir> ' +
            '(repeatable) or set TWEAKCC_OVERRIDE_SETS'
        );
        lcc.push(dir ?? '');
      } else {
        explicit.push(dir ?? '');
      }
      continue;
    }
    if (a.startsWith('--overrides=')) {
      specified = true;
      explicit.push(a.slice('--overrides='.length));
      continue;
    }
    if (a.startsWith('--set=')) {
      specified = true;
      explicit.push(a.slice('--set='.length));
      continue;
    }
    if (a.startsWith('--sets=')) {
      specified = true;
      for (const p of a.slice('--sets='.length).split(',')) {
        const t = p.trim();
        if (t) explicit.push(t);
      }
      continue;
    }
    if (a.startsWith('--lcc=')) {
      specified = true;
      console.error(
        'warning: --lcc is deprecated; pass --overrides <set-dir> ' +
          '(repeatable) or set TWEAKCC_OVERRIDE_SETS'
      );
      lcc.push(a.slice('--lcc='.length));
      continue;
    }
    rest.push(a);
  }
  return { explicit, lcc, requireSets, rest, specified };
}

function lccChildren(parent, io) {
  let names;
  try {
    names = io.readdir(parent);
  } catch {
    return null;
  }
  const out = [];
  for (const n of names) {
    if (!n.startsWith('system-prompts-')) continue;
    const p = path.join(parent, n);
    try {
      if (!io.stat(p).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push(p);
  }
  return out;
}

function resolveOverrideSets(
  parsed,
  {
    env = process.env,
    fallback = 'applied',
    exit = code => process.exit(code),
    exists = defaultExists,
    realpath = p => fs.realpathSync(p),
    readdir = p => fs.readdirSync(p),
    stat = p => fs.statSync(p),
    home,
  } = {}
) {
  const cfgOpts = { env, home, exists };
  const applied = appliedPromptsDir(cfgOpts);
  const io = { readdir, stat };

  const failMissing = p => {
    console.error(`override folder not found: ${p}`);
    exit(2);
    return [];
  };

  const nothing = p => {
    console.error(`no override folder at ${p}, nothing to audit`);
    exit(parsed.requireSets ? 2 : 0);
    return [];
  };

  const fromDirs = dirs => {
    const out = [];
    const seen = new Set();
    for (const d of dirs) {
      if (!d) return failMissing(d || '(empty)');
      if (!exists(d)) return failMissing(d);
      let rp;
      try {
        rp = realpath(d);
      } catch {
        return failMissing(d);
      }
      if (seen.has(rp)) continue;
      seen.add(rp);
      out.push({ dir: rp, name: path.basename(rp) });
    }
    return out;
  };

  const specified =
    parsed.specified ||
    (parsed.explicit && parsed.explicit.length > 0) ||
    (parsed.lcc && parsed.lcc.length > 0);

  if (specified) {
    const dirs = [...(parsed.explicit || [])];
    for (const parent of parsed.lcc || []) {
      if (!parent) return failMissing('(empty)');
      if (!exists(parent)) return failMissing(parent);
      const kids = lccChildren(parent, io);
      if (kids === null) return failMissing(parent);
      dirs.push(...kids);
    }
    const sets = fromDirs(dirs);
    if (!sets.length) return nothing(dirs[0] || applied);
    return sets;
  }

  if (fallback !== 'none') {
    const multi = env.TWEAKCC_OVERRIDE_SETS;
    if (multi != null && String(multi).length > 0) {
      const dirs = String(multi)
        .split(path.delimiter)
        .map(s => s.trim())
        .filter(Boolean);
      const sets = fromDirs(dirs);
      if (!sets.length) return nothing(dirs[0] || applied);
      return sets;
    }
    const single = env.TWEAKCC_OVERRIDE_SET;
    if (single != null && String(single).length > 0) {
      const sets = fromDirs([single]);
      if (!sets.length) return nothing(single);
      return sets;
    }
    if (fallback === 'applied') {
      if (exists(applied)) return fromDirs([applied]);
      return nothing(applied);
    }
  }

  return nothing(applied);
}

function remindersDirsFor(sets, opts = {}) {
  const { exists = defaultExists, realpath = p => fs.realpathSync(p) } = opts;
  const out = [];
  const seen = new Set();
  const add = p => {
    if (!p || !exists(p)) return;
    let rp;
    try {
      rp = realpath(p);
    } catch {
      return;
    }
    if (seen.has(rp)) return;
    seen.add(rp);
    out.push(rp);
  };
  add(appliedRemindersDir(opts));
  for (const s of sets || []) {
    if (!s || !s.dir) continue;
    add(path.join(path.dirname(s.dir), 'system-reminders'));
  }
  return out;
}

function printAuditedSets(sets) {
  const names = (sets || []).map(s => s.name).join(', ');
  console.log(`audited sets: ${names}`);
}

module.exports = {
  resolveConfigDir,
  appliedPromptsDir,
  appliedRemindersDir,
  pristineCliPath,
  parseOverrideArgs,
  resolveOverrideSets,
  remindersDirsFor,
  printAuditedSets,
};

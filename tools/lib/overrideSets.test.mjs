import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getConfigDir } from '../../src/config.ts';

const require = createRequire(import.meta.url);
const {
  resolveConfigDir,
  appliedPromptsDir,
  appliedRemindersDir,
  pristineCliPath,
  parseOverrideArgs,
  resolveOverrideSets,
  remindersDirsFor,
} = require('./overrideSets.cjs');

const ENV_KEYS = ['TWEAKCC_CONFIG_DIR', 'HOME', 'XDG_CONFIG_HOME'];

function saveEnv() {
  const out = {};
  for (const k of ENV_KEYS) {
    out[k] = process.env[k];
  }
  return out;
}

function restoreEnv(saved) {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function capture(fn) {
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let code = null;
  let result;
  try {
    result = fn(c => {
      code = c;
      const e = new Error('EXIT');
      e.code = c;
      throw e;
    });
  } catch (e) {
    if (e.message !== 'EXIT') {
      console.error = origErr;
      throw e;
    }
  }
  console.error = origErr;
  return { code, result, errs };
}

describe('resolveConfigDir', () => {
  it('uses TWEAKCC_CONFIG_DIR when set (trimmed, non-empty)', () => {
    expect(
      resolveConfigDir({
        env: { TWEAKCC_CONFIG_DIR: '  /tmp/cc  ' },
        home: '/home/u',
        exists: () => false,
      })
    ).toBe('/tmp/cc');
  });

  it('expands a leading tilde only on TWEAKCC_CONFIG_DIR', () => {
    const home = '/home/u';
    expect(
      resolveConfigDir({
        env: { TWEAKCC_CONFIG_DIR: '~/.tweakcc-alt' },
        home,
        exists: () => false,
      })
    ).toBe(path.join(home, '~/.tweakcc-alt'.slice(1)));
  });

  it('falls through when TWEAKCC_CONFIG_DIR is empty or whitespace', () => {
    expect(
      resolveConfigDir({
        env: { TWEAKCC_CONFIG_DIR: '   ' },
        home: '/home/u',
        exists: () => false,
      })
    ).toBe(path.join('/home/u', '.tweakcc'));
  });

  it('uses ~/.tweakcc when it exists', () => {
    expect(
      resolveConfigDir({
        env: {},
        home: '/home/u',
        exists: p => p === path.join('/home/u', '.tweakcc'),
      })
    ).toBe(path.join('/home/u', '.tweakcc'));
  });

  it('uses ~/.claude/tweakcc when ~/.tweakcc does not exist', () => {
    expect(
      resolveConfigDir({
        env: {},
        home: '/home/u',
        exists: p => p === path.join('/home/u', '.claude', 'tweakcc'),
      })
    ).toBe(path.join('/home/u', '.claude', 'tweakcc'));
  });

  it('uses $XDG_CONFIG_HOME/tweakcc when neither default exists', () => {
    expect(
      resolveConfigDir({
        env: { XDG_CONFIG_HOME: '/xdg' },
        home: '/home/u',
        exists: () => false,
      })
    ).toBe(path.join('/xdg', 'tweakcc'));
  });

  it('defaults to ~/.tweakcc', () => {
    expect(
      resolveConfigDir({
        env: {},
        home: '/home/u',
        exists: () => false,
      })
    ).toBe(path.join('/home/u', '.tweakcc'));
  });
});

describe('getConfigDir parity', () => {
  const saved = saveEnv();
  afterEach(() => restoreEnv(saved));

  function withHome(fn) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tweakcc-home-'));
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    delete process.env.TWEAKCC_CONFIG_DIR;
    delete process.env.XDG_CONFIG_HOME;
    try {
      fn(home);
    } finally {
      process.env.HOME = prevHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  it('branch 1: TWEAKCC_CONFIG_DIR wins, including tilde', () => {
    withHome(home => {
      process.env.TWEAKCC_CONFIG_DIR = '~/cfg';
      const a = getConfigDir();
      const b = resolveConfigDir({
        env: process.env,
        home: os.homedir(),
        exists: p => fs.existsSync(p),
      });
      expect(a).toBe(b);
      expect(a).toBe(path.join(home, '~/cfg'.slice(1)));
    });
  });

  it('branch 1b: empty TWEAKCC_CONFIG_DIR falls through', () => {
    withHome(home => {
      process.env.TWEAKCC_CONFIG_DIR = '  ';
      fs.mkdirSync(path.join(home, '.tweakcc'));
      const a = getConfigDir();
      const b = resolveConfigDir({
        env: process.env,
        home: os.homedir(),
        exists: p => fs.existsSync(p),
      });
      expect(a).toBe(b);
      expect(a).toBe(path.join(home, '.tweakcc'));
    });
  });

  it('branch 2: ~/.tweakcc exists', () => {
    withHome(home => {
      fs.mkdirSync(path.join(home, '.tweakcc'));
      const a = getConfigDir();
      const b = resolveConfigDir({
        env: process.env,
        home: os.homedir(),
        exists: p => fs.existsSync(p),
      });
      expect(a).toBe(b);
      expect(a).toBe(path.join(home, '.tweakcc'));
    });
  });

  it('branch 3: ~/.claude/tweakcc exists', () => {
    withHome(home => {
      fs.mkdirSync(path.join(home, '.claude', 'tweakcc'), { recursive: true });
      const a = getConfigDir();
      const b = resolveConfigDir({
        env: process.env,
        home: os.homedir(),
        exists: p => fs.existsSync(p),
      });
      expect(a).toBe(b);
      expect(a).toBe(path.join(home, '.claude', 'tweakcc'));
    });
  });

  it('branch 4: XDG_CONFIG_HOME', () => {
    withHome(home => {
      const xdg = path.join(home, 'xdg');
      fs.mkdirSync(xdg);
      process.env.XDG_CONFIG_HOME = xdg;
      const a = getConfigDir();
      const b = resolveConfigDir({
        env: process.env,
        home: os.homedir(),
        exists: p => fs.existsSync(p),
      });
      expect(a).toBe(b);
      expect(a).toBe(path.join(xdg, 'tweakcc'));
    });
  });

  it('branch 5: default ~/.tweakcc', () => {
    withHome(home => {
      const a = getConfigDir();
      const b = resolveConfigDir({
        env: process.env,
        home: os.homedir(),
        exists: p => fs.existsSync(p),
      });
      expect(a).toBe(b);
      expect(a).toBe(path.join(home, '.tweakcc'));
    });
  });
});

describe('applied / reminders / pristine paths', () => {
  it('are under the resolved config dir', () => {
    const opts = {
      env: { TWEAKCC_CONFIG_DIR: '/tmp/cc' },
      home: '/h',
      exists: () => false,
    };
    expect(appliedPromptsDir(opts)).toBe(path.join('/tmp/cc', 'system-prompts'));
    expect(appliedRemindersDir(opts)).toBe(
      path.join('/tmp/cc', 'system-reminders')
    );
    expect(pristineCliPath(opts)).toBe(
      path.join('/tmp/cc', 'native-claudejs-orig.js')
    );
  });
});

describe('parseOverrideArgs', () => {
  it('consumes every spelling and preserves rest order', () => {
    const parsed = parseOverrideArgs([
      '2.1.276',
      '--set=/a',
      '--overrides',
      '/b',
      '--overrides=/c',
      '--sets=/d,/e',
      '--fix',
      '--json',
      'out.json',
      '--require-sets',
    ]);
    expect(parsed.explicit).toEqual(['/a', '/b', '/c', '/d', '/e']);
    expect(parsed.requireSets).toBe(true);
    expect(parsed.specified).toBe(true);
    expect(parsed.rest).toEqual(['2.1.276', '--fix', '--json', 'out.json']);
    expect(parsed.lcc).toEqual([]);
  });

  it('records --lcc as a parent and prints a deprecation warning', () => {
    const errs = [];
    const orig = console.error;
    console.error = (...a) => errs.push(a.join(' '));
    const parsed = parseOverrideArgs(['--lcc', '/parent', 'pos']);
    console.error = orig;
    expect(parsed.lcc).toEqual(['/parent']);
    expect(parsed.specified).toBe(true);
    expect(parsed.rest).toEqual(['pos']);
    expect(errs.join('\n')).toMatch(/deprecated/);
  });

  it('leaves unrelated flags in rest', () => {
    const parsed = parseOverrideArgs([
      '--cli',
      '/cli.js',
      '--json',
      'p.json',
      '--all',
    ]);
    expect(parsed.explicit).toEqual([]);
    expect(parsed.specified).toBe(false);
    expect(parsed.rest).toEqual(['--cli', '/cli.js', '--json', 'p.json', '--all']);
  });
});

describe('resolveOverrideSets', () => {
  it('replace-precedence: flags beat env beat applied', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsets-'));
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    const c = path.join(root, 'applied', 'system-prompts');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.mkdirSync(c, { recursive: true });
    try {
      const { result } = capture(exit =>
        resolveOverrideSets(
          { explicit: [a], lcc: [], specified: true, requireSets: false },
          {
            env: {
              TWEAKCC_OVERRIDE_SETS: b,
              TWEAKCC_CONFIG_DIR: path.join(root, 'applied'),
            },
            fallback: 'applied',
            exit,
          }
        )
      );
      expect(result.map(s => s.dir)).toEqual([fs.realpathSync(a)]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses TWEAKCC_OVERRIDE_SETS then TWEAKCC_OVERRIDE_SET then applied', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsets-'));
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    const applied = path.join(root, 'cfg', 'system-prompts');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.mkdirSync(applied, { recursive: true });
    try {
      const multi = capture(exit =>
        resolveOverrideSets(
          { explicit: [], lcc: [], specified: false, requireSets: false },
          {
            env: {
              TWEAKCC_OVERRIDE_SETS: [a, b].join(path.delimiter),
              TWEAKCC_OVERRIDE_SET: applied,
              TWEAKCC_CONFIG_DIR: path.join(root, 'cfg'),
            },
            fallback: 'applied',
            exit,
          }
        )
      );
      expect(multi.result.map(s => s.name).sort()).toEqual(['a', 'b']);

      const single = capture(exit =>
        resolveOverrideSets(
          { explicit: [], lcc: [], specified: false, requireSets: false },
          {
            env: {
              TWEAKCC_OVERRIDE_SET: a,
              TWEAKCC_CONFIG_DIR: path.join(root, 'cfg'),
            },
            fallback: 'applied',
            exit,
          }
        )
      );
      expect(single.result.map(s => s.dir)).toEqual([fs.realpathSync(a)]);

      const app = capture(exit =>
        resolveOverrideSets(
          { explicit: [], lcc: [], specified: false, requireSets: false },
          {
            env: { TWEAKCC_CONFIG_DIR: path.join(root, 'cfg') },
            fallback: 'applied',
            exit,
          }
        )
      );
      expect(app.result.map(s => s.dir)).toEqual([fs.realpathSync(applied)]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fallback none ignores env vars', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsets-'));
    const a = path.join(root, 'a');
    fs.mkdirSync(a);
    try {
      const { code, errs } = capture(exit =>
        resolveOverrideSets(
          { explicit: [], lcc: [], specified: false, requireSets: false },
          {
            env: {
              TWEAKCC_OVERRIDE_SETS: a,
              TWEAKCC_OVERRIDE_SET: a,
              TWEAKCC_CONFIG_DIR: root,
            },
            fallback: 'none',
            exit,
          }
        )
      );
      expect(code).toBe(0);
      expect(errs.join('\n')).toMatch(/nothing to audit/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('missing explicit folder exits 2', () => {
    const { code, errs } = capture(exit =>
      resolveOverrideSets(
        {
          explicit: ['/no/such/override-set'],
          lcc: [],
          specified: true,
          requireSets: false,
        },
        { env: {}, fallback: 'applied', exit }
      )
    );
    expect(code).toBe(2);
    expect(errs.join('\n')).toMatch(/not found/);
  });

  it('nothing resolved exits 0, or 2 with --require-sets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsets-'));
    try {
      const none = capture(exit =>
        resolveOverrideSets(
          { explicit: [], lcc: [], specified: false, requireSets: false },
          {
            env: { TWEAKCC_CONFIG_DIR: root },
            fallback: 'applied',
            exit,
          }
        )
      );
      expect(none.code).toBe(0);
      expect(none.errs.join('\n')).toMatch(/nothing to audit/);

      const req = capture(exit =>
        resolveOverrideSets(
          { explicit: [], lcc: [], specified: false, requireSets: true },
          {
            env: { TWEAKCC_CONFIG_DIR: root },
            fallback: 'applied',
            exit,
          }
        )
      );
      expect(req.code).toBe(2);
      expect(req.errs.join('\n')).toMatch(/nothing to audit/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('expands --lcc to system-prompts-* children and de-dupes by realpath', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsets-'));
    const child = path.join(root, 'system-prompts-opus-5');
    const other = path.join(root, 'notes');
    fs.mkdirSync(child);
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(root, 'system-prompts-notdir'), 'x');
    try {
      const { result } = capture(exit =>
        resolveOverrideSets(
          {
            explicit: [child],
            lcc: [root],
            specified: true,
            requireSets: false,
          },
          { env: {}, fallback: 'none', exit }
        )
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('system-prompts-opus-5');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('remindersDirsFor', () => {
  it('adds applied reminders plus a sibling per set, de-duped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovsets-'));
    const cfg = path.join(root, 'cfg');
    const lcc = path.join(cfg, 'lcc');
    const setA = path.join(lcc, 'system-prompts-a');
    const reminders = path.join(lcc, 'system-reminders');
    const applied = path.join(cfg, 'system-reminders');
    fs.mkdirSync(setA, { recursive: true });
    fs.mkdirSync(reminders);
    fs.symlinkSync(reminders, applied);
    try {
      const dirs = remindersDirsFor([{ dir: fs.realpathSync(setA), name: 'a' }], {
        env: { TWEAKCC_CONFIG_DIR: cfg },
      });
      expect(dirs).toEqual([fs.realpathSync(reminders)]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  asciiRuns,
  literalRuns,
  coverageReport,
  applyAllowlist,
} from './checkPromptCoverage.mjs';

const P = (id, ...pieces) => ({ id, pieces });
const LONG = 'x'.repeat(60);

describe('literalRuns', () => {
  it('splits at interpolations, since only the literal text is in the bundle', () => {
    const runs = literalRuns([`${LONG}A\${VAR}${LONG}B`]);
    expect(runs).toHaveLength(2);
    expect(runs.every(r => !r.includes('${'))).toBe(true);
  });

  it('drops runs shorter than the probe floor', () => {
    expect(literalRuns(['too short'])).toEqual([]);
  });

  it('normalises whitespace so a re-wrapped body still matches', () => {
    expect(literalRuns([`${LONG}\n  \n${LONG}`])[0]).toContain('x x');
  });
});

describe('asciiRuns', () => {
  // The bundle stores non-ASCII as \uXXXX. A probe carrying an em-dash — which
  // most Anthropic prose does — can never be found in it, so probes must be
  // split at every non-ASCII codepoint. Getting this wrong reported 53 real
  // gaps as "not ours".
  it('splits at non-ASCII rather than returning a probe that can never match', () => {
    const runs = asciiRuns(`${LONG} — ${LONG}`);
    expect(runs).toHaveLength(2);
    expect(runs.every(r => [...r].every(c => c.charCodeAt(0) < 128))).toBe(
      true
    );
  });

  it('returns nothing when no ASCII run survives the floor', () => {
    expect(asciiRuns('— — —')).toEqual([]);
  });
});

describe('coverageReport', () => {
  it('flags a prompt that is in the binary but not in our catalogue', () => {
    const { missing } = coverageReport(
      [P('ours', 'something else entirely that is quite long indeed yes')],
      [P('theirs', `${LONG}MISSING`)],
      `var a = "${LONG}MISSING";`
    );
    expect(missing.map(m => m.id)).toEqual(['theirs']);
  });

  it('does not flag a prompt we already carry', () => {
    const { missing } = coverageReport(
      [P('ours', `${LONG}SHARED`)],
      [P('theirs', `${LONG}SHARED`)],
      `var a = "${LONG}SHARED";`
    );
    expect(missing).toEqual([]);
  });

  it('separates "absent from this binary" from a real gap', () => {
    // A reference catalogue built from a different platform or channel carries
    // prompts this binary genuinely does not have. Those are not our debt.
    const { missing, notOurs } = coverageReport(
      [P('ours', 'unrelated body text that is long enough to be a probe ok')],
      [P('elsewhere', `${LONG}NOTHERE`)],
      'var a = "a completely different bundle";'
    );
    expect(missing).toEqual([]);
    expect(notOurs.map(m => m.id)).toEqual(['elsewhere']);
  });

  it('finds a body whose only usable probe is an ASCII fragment', () => {
    const { missing } = coverageReport(
      [P('ours', 'nothing in common here at all, truly nothing whatsoever')],
      [P('theirs', `${LONG}TAIL — ${LONG}HEAD`)],
      `var a = "${LONG}TAIL \\u2014 ${LONG}HEAD";`
    );
    expect(missing.map(m => m.id)).toEqual(['theirs']);
  });

  it('reports unprobeable entries instead of silently counting them covered', () => {
    const { missing, unprobeable } = coverageReport(
      [P('ours', LONG)],
      [P('theirs', 'short')],
      'var a = 1;'
    );
    expect(missing).toEqual([]);
    expect(unprobeable).toEqual(['theirs']);
  });
});

describe('applyAllowlist', () => {
  const report = {
    missing: [
      { id: 'sdk-field', tokens: 10 },
      { id: 'real-gap', tokens: 20 },
    ],
    spanDiff: [],
    notOurs: [{ id: 'left-binary', tokens: 5 }],
    unprobeable: ['too-short'],
  };
  const reference = [
    'sdk-field',
    'real-gap',
    'left-binary',
    'too-short',
    'ours',
  ].map(id => ({ id, pieces: [] }));
  const row = { verdict: 'not-model-facing', version: '1', why: 'traced' };

  it('filters allowlisted ids out of missing', () => {
    const r = applyAllowlist(report, { 'sdk-field': row }, reference);
    expect(r.missing.map(m => m.id)).toEqual(['real-gap']);
    expect(r.allowlisted.map(m => m.id)).toEqual(['sdk-field']);
    expect(r.stale).toEqual([]);
  });

  it('reports a row stale for every way its reason can expire', () => {
    const r = applyAllowlist(
      report,
      {
        ours: row,
        'left-binary': row,
        'too-short': row,
        renamed: row,
      },
      reference
    );
    expect(Object.fromEntries(r.stale.map(s => [s.id, s.why]))).toEqual({
      ours: 'catalogued by us',
      'left-binary': 'not in the binary',
      'too-short': 'unprobeable',
      renamed: 'not in the reference',
    });
  });
});

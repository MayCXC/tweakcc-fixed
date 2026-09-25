import { describe, it, expect } from 'vitest';
import { resolvePatchFilter } from './patchFilter';

// 'verbose-property' and 'read-default-lines' are stable always-applied IDs.
describe('resolvePatchFilter', () => {
  it('returns null filter (apply all) when no --patches given', () => {
    expect(resolvePatchFilter(undefined)).toEqual({ ok: true, filter: null });
    expect(resolvePatchFilter(null)).toEqual({ ok: true, filter: null });
    expect(resolvePatchFilter('')).toEqual({ ok: true, filter: null });
  });

  it('accepts valid IDs and trims/drops blanks', () => {
    expect(resolvePatchFilter('verbose-property,read-default-lines')).toEqual({
      ok: true,
      filter: ['verbose-property', 'read-default-lines'],
    });
    expect(resolvePatchFilter(' verbose-property , ')).toEqual({
      ok: true,
      filter: ['verbose-property'],
    });
  });

  it('rejects an unknown ID (a typo would otherwise silently apply nothing)', () => {
    const r = resolvePatchFilter('verbose-property,nonexistent-xyz');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('nonexistent-xyz');
  });

  it("accepts a system prompt ID of the version's loaded prompts", () => {
    const promptIds = ['system-prompt-claude-agent-identity-sdk'];
    expect(
      resolvePatchFilter('system-prompt-claude-agent-identity-sdk', promptIds)
    ).toEqual({
      ok: true,
      filter: ['system-prompt-claude-agent-identity-sdk'],
    });
    expect(
      resolvePatchFilter(
        'verbose-property,system-prompt-claude-agent-identity-sdk',
        promptIds
      )
    ).toEqual({
      ok: true,
      filter: ['verbose-property', 'system-prompt-claude-agent-identity-sdk'],
    });
  });

  it('rejects a system prompt ID an override shadows', () => {
    const r = resolvePatchFilter(
      'system-prompt-claude-agent-identity-sdk',
      ['system-prompt-claude-agent-identity-sdk'],
      new Map([
        [
          'inline-blob.md',
          new Set(['system-prompt-claude-agent-identity-sdk']),
        ],
      ])
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('shadowed');
      expect(r.error).toContain('system-prompt-claude-agent-identity-sdk');
      expect(r.error).toContain('inline-blob');
      expect(r.error).toContain('applies on every --apply');
    }
  });

  it('names a prompt owner and suggests its ID', () => {
    const r = resolvePatchFilter(
      'shadowed-prompt',
      ['shadowed-prompt', 'owning-prompt'],
      new Map([['owning-prompt', new Set(['shadowed-prompt'])]])
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error).toContain('pass --patches owning-prompt instead');
  });

  it('reports unknown and shadowed IDs together', () => {
    const r = resolvePatchFilter(
      'bogus-xyz,shadowed-prompt',
      ['shadowed-prompt'],
      new Map([['reminder-override', new Set(['shadowed-prompt'])]])
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('bogus-xyz');
      expect(r.error).toContain('shadowed-prompt');
      expect(r.error).toContain('reminder-override');
    }
  });

  it('does not check patch IDs against prompt shadows', () => {
    expect(
      resolvePatchFilter(
        'verbose-property',
        [],
        new Map([['inline-blob', new Set(['verbose-property'])]])
      )
    ).toEqual({ ok: true, filter: ['verbose-property'] });
  });

  it('rejects a system prompt ID when no prompts are loaded', () => {
    const r = resolvePatchFilter('system-prompt-claude-agent-identity-sdk');
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error).toContain('system-prompt-claude-agent-identity-sdk');
  });

  it('rejects a filter that contains no usable IDs', () => {
    const r = resolvePatchFilter(' , , ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no patch or system prompt IDs');
  });
});

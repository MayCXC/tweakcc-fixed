import { describe, it, expect } from 'vitest';
import { writeSessionColor, patchSaveAgentColor } from './sessionColor';

const makeSaveAgentColor = () =>
  ';async function Mr$(H,$,q){let K=q??sT(H);' +
  'try{await Hv(K,{type:"agent-color",agentColor:$,sessionId:H})}' +
  'catch(z){if(Qd(z))w(`saveAgentColor failed (${Yt(z)}): ${ne(z)}`,{level:"error"});else throw z}' +
  'if(H===V$())WA().currentSessionAgentColor=$;c("tengu_agent_color_set",{})}';

const makeOptionsArgSaveAgentColor = () =>
  ';async function Mr$(H,$,q,z){let K=q??sT(H);' +
  'try{await Hv(K,{type:"agent-color",agentColor:$,sessionId:H},z)}' +
  'catch(J){if(Qd(J))w(`saveAgentColor failed (${Yt(J)}): ${ne(J)}`,{level:"error"});else throw J}' +
  'if(H===V$())WA().currentSessionAgentColor=$;c("tengu_agent_color_set",{})}';

const makeCLIState = () =>
  'effortValue:oR(w.effort),' +
  'activeOverlays:new Set,fastMode:cP8(N5),' +
  '...(uF()&&d1&&{advisorModel:d1})';

const named = '...no&&{standaloneAgentContext:{name:no}},';

const makeFullFile = () => 'first{' + makeCLIState() + makeSaveAgentColor();

describe('sessionColor', () => {
  describe('writeSessionColor', () => {
    it('should inject into CLI initialState and patch saveAgentColor', () => {
      const result = writeSessionColor(makeFullFile());
      expect(result).not.toBeNull();
      expect(result).toContain('TWEAKCC_SESSION_COLOR');
      expect(result).toContain('standaloneAgentContext:{name:__n,color:__c}');
      expect(result).toContain('__tweakccSaveAgentColor');
    });

    it('contributes nothing when no color is set, so --name survives', () => {
      // `claude --name foo` reaches the session through this spread. A plain
      // standaloneAgentContext key added later in the same literal outranks it.
      const result = writeSessionColor(
        'first{' + named + makeCLIState() + makeSaveAgentColor()
      );
      expect(result).not.toBeNull();
      // The original spread is left intact rather than replaced.
      expect(result).toContain(named);
      // And the injection yields {} rather than a key, so it cannot outrank it.
      expect(result).toContain('.includes(__c))return{}');
      expect(result).toContain(',...(()=>{');
    });

    it('carries the name through when a color is set', () => {
      const result = writeSessionColor(
        'first{' + named + makeCLIState() + makeSaveAgentColor()
      );
      expect(result).not.toBeNull();
      // The name variable found in the spread is read back, not hardcoded away.
      expect(result).toContain('typeof no==="undefined"?"":no||""');
    });

    it('should validate color against allowed list', () => {
      const result = writeSessionColor(makeFullFile())!;
      expect(result).toContain('.includes(__c)');
      expect(result).toContain('"green"');
      expect(result).toContain('"cyan"');
    });

    it('should be idempotent', () => {
      const first = writeSessionColor(makeFullFile())!;
      const second = writeSessionColor(first)!;
      expect(second).toBe(first);
    });

    it('should return null when no pattern found', () => {
      const result = writeSessionColor('not a valid file');
      expect(result).toBeNull();
    });

    it('should color the session when no saveAgentColor anchor exists', () => {
      const result = writeSessionColor('first{' + makeCLIState());
      expect(result).not.toBeNull();
      expect(result).toContain('TWEAKCC_SESSION_COLOR');
      expect(result).toContain('standaloneAgentContext:{name:__n,color:__c}');
      // The store itself is what this bundle lacks, so the assignment is absent
      // while the guarded call remains, leaving that one path inert at runtime.
      expect(result).not.toContain('globalThis.__tweakccSaveAgentColor=');
      expect(result).toContain(
        'if(globalThis.__tweakccSaveAgentColor)globalThis.__tweakccSaveAgentColor(__c)'
      );
    });

    it('should schedule color save via queueMicrotask', () => {
      const result = writeSessionColor(makeFullFile())!;
      expect(result).toContain('queueMicrotask');
      expect(result).toContain('__tweakccSaveAgentColor');
    });

    it('should expose saveAgentColor on globalThis', () => {
      const result = writeSessionColor(makeFullFile())!;
      expect(result).toContain(
        'globalThis.__tweakccSaveAgentColor=(c)=>Mr$(V$(),c)'
      );
    });
  });

  describe('patchSaveAgentColor', () => {
    it('should patch saveAgentColor with try/catch awaited write', () => {
      const result = patchSaveAgentColor(makeSaveAgentColor());
      expect(result).not.toBeNull();
      expect(result).toContain('globalThis.__tweakccSaveAgentColor');
      expect(result).toContain('try{await Hv(K,');
      expect(result).toContain('(c)=>Mr$(V$(),c)');
    });

    it('should patch saveAgentColor that takes an options argument', () => {
      const result = patchSaveAgentColor(makeOptionsArgSaveAgentColor());
      expect(result).not.toBeNull();
      expect(result).toContain('globalThis.__tweakccSaveAgentColor');
      expect(result).toContain('try{await Hv(K,');
      expect(result).toContain('sessionId:H},z)');
      expect(result).toContain('(c)=>Mr$(V$(),c)');
    });

    it('should return null when pattern not found', () => {
      const result = patchSaveAgentColor('no match here');
      expect(result).toBeNull();
    });

    it('should preserve original function', () => {
      const result = patchSaveAgentColor(makeSaveAgentColor())!;
      expect(result).toContain('async function Mr$');
      expect(result).toContain('type:"agent-color"');
    });
  });
});

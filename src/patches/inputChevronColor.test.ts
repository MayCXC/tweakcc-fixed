import { describe, it, expect } from 'vitest';

import { writeInputChevronColor } from './inputChevronColor';

describe('writeInputChevronColor', () => {
  // Backward compatibility: the older member-call JSX factory shape
  // (`X.jsxs(Y,{color,dimColor,children:...})`) that Piebald's original anchor
  // targeted still matches, so the patch keeps working on older CC builds.
  it('rewrites the older member-call factory shape', () => {
    const input =
      'var a=1,{isLoading:n,themeColor:r}=e,s=r??void 0,i;' +
      'if(t[0]!==s||t[1]!==n)' +
      'i=Kne.jsxs(w,{color:s,dimColor:n,children:[et.pointer,"\\xA0"]}),t[2]=i;else i=t[2];return i';
    const result = writeInputChevronColor(input, 'red');

    expect(result).not.toBeNull();
    expect(result).toContain('color:n?s:"red",dimColor:!1');
    expect(result).not.toContain('color:s,dimColor:n');
  });

  it('handles the isScreenReader field and a 3-term memo guard', () => {
    const input =
      'var z=1,{isLoading:n,isScreenReader:r,themeColor:o}=e,i=o??void 0,a=r?"$":ct.pointer,l;' +
      'if(t[0]!==i||t[1]!==n||t[2]!==a)' +
      'l=yQe.jsx(w,{color:i,dimColor:n,children:a}),t[0]=i;else l=t[3]';
    const result = writeInputChevronColor(input, 'red');

    expect(result).not.toBeNull();
    expect(result).toContain('color:n?i:"red",dimColor:!1');
    expect(result).not.toContain('color:i,dimColor:n');
  });

  // CC 2.1.273: the render migrated to a BARE factory call
  // (`e(Y,{color,dimColor,children:...})`) with no `X.jsxs` member, plus the
  // isScreenReader field. This is the exact shape extracted from the 2.1.273
  // pristine bundle; it is what Piebald's stale `.jsxs(` anchor stopped matching.
  it('handles the CC 2.1.273 bare-factory shape', () => {
    const input =
      'var x=1,{isLoading:Fwt,isScreenReader:Bwt,themeColor:ahr}=shr,Uwt=ahr??void 0,aOe;' +
      'if(lSo[0]!==Bwt)aOe=Bwt?e(B,{children:"$\\xA0"}):r(B,{children:[F.pointer,"\\xA0"]}),lSo[0]=Bwt,lSo[1]=aOe;else aOe=lSo[1];let cSo;' +
      'if(lSo[2]!==Uwt||lSo[3]!==Fwt||lSo[4]!==aOe)' +
      'cSo=e(n,{color:Uwt,dimColor:Fwt,children:aOe}),lSo[2]=Uwt;else cSo=lSo[5];return cSo';
    const result = writeInputChevronColor(input, 'red');

    expect(result).not.toBeNull();
    expect(result).toContain('color:Fwt?Uwt:"red",dimColor:!1');
    expect(result).not.toContain('color:Uwt,dimColor:Fwt');
  });

  it('works with different identifier names', () => {
    const input =
      'var a=1,{isLoading:X$,themeColor:Y$}=Z$,W$=Y$??void 0,V$;' +
      'if(Q$[0]!==W$||Q$[1]!==X$)' +
      'V$=R$(T$,{color:W$,dimColor:X$,children:[U$.pointer,"\\xA0"]})';
    const result = writeInputChevronColor(input, 'blue');

    expect(result).not.toBeNull();
    expect(result).toContain('color:X$?W$:"blue",dimColor:!1');
  });

  it('returns null when pattern not found', () => {
    expect(writeInputChevronColor('const x=1;', 'red')).toBeNull();
  });

  it('returns null when already patched', () => {
    const once = writeInputChevronColor(
      'var a=1,{isLoading:n,themeColor:r}=e,s=r??void 0,i;' +
        'if(t[0]!==s||t[1]!==n)' +
        'i=Kne.jsxs(w,{color:s,dimColor:n,children:[et.pointer,"\\xA0"]})',
      'red'
    )!;
    expect(writeInputChevronColor(once, 'red')).toBeNull();
  });
});

import { debug } from '../utils';
import { showDiff } from './index';

// Ported from Piebald upstream (src/patches/inputChevronColor.ts) and re-anchored
// for CC 2.1.273. Upstream targets CC 2.1.162; by 2.1.273 the input-chevron
// component's render migrated from a member-call JSX factory
// (`X.jsxs(Y,{color,dimColor,children:...})`) to a bare factory call
// (`e(Y,{color,dimColor,children:...})`), so the old anchor's `[$\w]+\.jsxs?\(`
// no longer matched. The factory-member group is now optional, which matches the
// 2.1.273 bare-call shape while still matching the older member-call shape. The
// destructure gained `isScreenReader:`, already covered by the
// `(?:[$\w]+:[$\w]+,)*` run between `isLoading:` and `themeColor:`.
export const writeInputChevronColor = (
  file: string,
  resolvedColor: string
): string | null => {
  const pattern =
    /,\{isLoading:([$\w]+),(?:[$\w]+:[$\w]+,)*themeColor:([$\w]+)\}=[$\w]+,([$\w]+)=\2\?\?void 0[,;][\s\S]*?if\([^)]*!==\3[^)]*\|\|[^)]*!==\1[^)]*\)[$\w]+=[$\w]+(?:\.jsxs?)?\([$\w]+,\{color:\3,dimColor:\1,children:/;

  const match = file.match(pattern);

  if (!match || match.index === undefined) {
    debug('patch: inputChevronColor: failed to find chevron component pattern');
    return null;
  }

  const isLoadingVar = match[1];
  const resolvedColorVar = match[3];

  const oldColorPart = `color:${resolvedColorVar},dimColor:${isLoadingVar}`;
  const newColorPart = `color:${isLoadingVar}?${resolvedColorVar}:${JSON.stringify(resolvedColor)},dimColor:!1`;

  const colorPartIndex = match[0].lastIndexOf(oldColorPart);
  const startIndex = match.index + colorPartIndex;
  const endIndex = startIndex + oldColorPart.length;

  const newFile =
    file.slice(0, startIndex) + newColorPart + file.slice(endIndex);

  showDiff(file, newFile, newColorPart, startIndex, endIndex);

  return newFile;
};

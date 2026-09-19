import { showDiff } from './index';
import { debug } from '../utils';

const VALID_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
];

// `claude --name foo` reaches the session through a spread earlier in the same
// app-state literal: `...<n>&&{standaloneAgentContext:{name:<n>}}`. A plain
// `standaloneAgentContext:` key added after it wins outright, so it drops the name
// on every install, color or no color. Contributing a SPREAD instead keeps the two
// independent: with no color requested it contributes nothing and the original
// spread stands, and with one it carries the name through alongside the color.
const NAME_SPREAD = /\.\.\.([$\w]+)&&\{standaloneAgentContext:\{name:\1\}\}/;

// The name variable is a sibling in the same literal, so it is in scope at the
// injection point. Where the bundle has no such spread, there is no name to keep
// and the color stands alone.
const injectionFor = (nameVar: string | null): string =>
  `,...(()=>{` +
  `let __c=process.env.TWEAKCC_SESSION_COLOR;` +
  `if(!__c||!${JSON.stringify(VALID_COLORS)}.includes(__c))return{};` +
  `queueMicrotask(()=>{` +
  `if(globalThis.__tweakccSaveAgentColor)globalThis.__tweakccSaveAgentColor(__c)` +
  `});` +
  `let __n=${nameVar ? `(typeof ${nameVar}==="undefined"?"":${nameVar}||"")` : '""'};` +
  `return{standaloneAgentContext:{name:__n,color:__c}}` +
  `})()`;

export const writeSessionColor = (oldFile: string): string | null => {
  if (oldFile.includes('let __c=process.env.TWEAKCC_SESSION_COLOR;if(!__c')) {
    return oldFile;
  }

  const nameVar = oldFile.match(NAME_SPREAD)?.[1] ?? null;
  const INJECTION = injectionFor(nameVar);

  const patterns = [
    /,activeOverlays:new Set,fastMode:[$\w]+\([$\w]+\)/,
    /,activeOverlays:new Set,fastMode:!1\}/,
  ];

  let result = oldFile;
  let patched = false;

  for (const pattern of patterns) {
    const match = result.match(pattern);
    if (!match || match.index === undefined) continue;

    const prePatch = result;
    const replacement = INJECTION + match[0];
    result =
      prePatch.slice(0, match.index) +
      replacement +
      prePatch.slice(match.index + match[0].length);

    showDiff(
      prePatch,
      result,
      INJECTION,
      match.index,
      match.index + match[0].length
    );
    patched = true;
  }

  if (!patched) {
    debug('patch: sessionColor: failed to find app state init patterns');
    return null;
  }

  // Remembering the color across sessions is a second, independent anchor, and
  // the color does not depend on it. The injection reaches the store through
  // `if(globalThis.__tweakccSaveAgentColor)`, so when this anchor finds nothing
  // the hook is simply absent: the session is still colored and only the memory
  // of it between sessions is lost. Since the two anchors differ sharply in how
  // much of the bundle they pin (an app-state literal against a minified async
  // function matched through seven groups), tying them together would let the
  // narrower one take a working color patch down with it.
  const withSavedColor = patchSaveAgentColor(result);
  if (!withSavedColor) {
    debug(
      'patch: sessionColor: no saveAgentColor anchor; color applies without cross-session persistence'
    );
    return result;
  }

  return withSavedColor;
};

export const patchSaveAgentColor = (oldFile: string): string | null => {
  const prefix =
    '([,;{}])' +
    '(async function ([$\\w]+)' +
    '\\(([$\\w]+),([$\\w]+),([$\\w]+)(?:,[$\\w]+)?\\)' +
    '\\{let [$\\w]+=\\6\\?\\?[$\\w]+\\(\\4\\);';

  const patterns = [
    new RegExp(
      prefix +
        'if\\((?:await )?[$\\w]+\\([$\\w]+,' +
        '\\{type:"agent-color",agentColor:\\5,sessionId:\\4\\}(?:,[$\\w]+)?\\),' +
        '\\4===([$\\w]+)\\(\\)\\))'
    ),
    new RegExp(
      prefix +
        'try\\{await [$\\w]+\\([$\\w]+,' +
        '\\{type:"agent-color",agentColor:\\5,sessionId:\\4\\}(?:,[$\\w]+)?\\)\\}' +
        'catch\\([$\\w]+\\)\\{[\\s\\S]*?\\}' +
        'if\\(\\4===([$\\w]+)\\(\\)\\))'
    ),
  ];

  let match: RegExpMatchArray | null = null;
  for (const pattern of patterns) {
    match = oldFile.match(pattern);
    if (match && match.index !== undefined) break;
    match = null;
  }
  if (!match || match.index === undefined) {
    return null;
  }

  const delimiter = match[1];
  const funcBody = match[2];
  const funcName = match[3];
  const getSessionIdName = match[7];

  const injection =
    `globalThis.__tweakccSaveAgentColor=` +
    `(c)=>${funcName}(${getSessionIdName}(),c);`;

  const replacement = `${delimiter}${injection}${funcBody}`;

  const result =
    oldFile.slice(0, match.index) +
    replacement +
    oldFile.slice(match.index + match[0].length);

  showDiff(
    oldFile,
    result,
    injection,
    match.index,
    match.index + match[0].length
  );

  return result;
};

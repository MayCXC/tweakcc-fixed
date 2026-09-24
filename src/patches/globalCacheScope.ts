// Please see the note about writing patches in ./index
//
// Against Anthropic's first-party API, Claude Code marks the static part of its
// system prompt with `cache_control: {scope: "global"}`, a cache shared across
// accounts. Anthropic accepts that scope only when the system block before the
// marked one is one of Claude Code's own identity lines. With the identity line
// replaced, or removed, every request is refused before any model runs:
//
//     400 `cache_control.scope: "global"` is only valid when every preceding
//     block is also globally scoped. A block with `scope: "global"` was found
//     after content with a narrower cache scope.
//
// The identity line is all it checks: a replaced tool description, a different
// tool set, and edited text inside the marked block are accepted.
//
// The identity lines are the string literals of the set Claude Code's
// system-prompt split checks with `.has()`: the CLI line and the two Agent SDK
// lines, gathered into an array and a Set built from it.
//
// While they match the pristine bundle's, this patch leaves the bundle alone.
// Once an override has changed one, it turns off the predicate every
// global-scope decision reads: a function of no arguments that answers false
// unless two feature checks pass, and otherwise answers whether the API
// provider is first-party or Anthropic on AWS.
//
// Its readers are the system prompt's split into a global and an organization
// block, the cache-scope request beta, and the one side query that builds its
// own marker from a call to it inside a `scope:` conditional. Answering false
// takes the path Claude Code takes behind a custom base URL: the same blocks
// cache for the same TTL at organization scope.
//
// Names churn and repeat across modules, so the predicate is taken by its shape
// AND by being the function called in `scope:X()?"global"`, and the identity
// set by being the one checked right after the split reports
// "tengu_sysprompt_using_tool_based_cache".

import { debug } from '../utils';
import { showDiff } from './index';

const PREDICATE =
  /function ([$\w]+)\(\)\{if\(!([$\w]+)\(\)\)return!1;if\(!([$\w]+)\(\)\)return!1;let ([$\w]+)=([$\w]+)\(\);return \4==="firstParty"\|\|\4==="anthropicAws"\}/g;
const GLOBAL_SCOPE_CALLER = /scope:([$\w]+)\(\)\?"global"/g;
const SPLIT_TELEMETRY = '"tengu_sysprompt_using_tool_based_cache"';
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/
  .source;

const escapeName = (name: string): string => name.replace(/\$/g, '\\$');

/**
 * The source text of each identity literal, in the order of the array Claude
 * Code builds its identity set from, or null when the shape is not found.
 */
export const identityLiterals = (file: string): string[] | null => {
  const split = file.indexOf(SPLIT_TELEMETRY);
  if (split === -1) return null;
  const check = /else if\(([$\w]+)\.has\(/.exec(
    file.slice(split, split + 2000)
  );
  if (!check) return null;
  const declaration = new RegExp(
    `([$\\w]+)=\\[([$\\w]+(?:,[$\\w]+)*)\\],${escapeName(check[1])}=new Set\\(\\1\\)`
  ).exec(file);
  if (!declaration) return null;

  // Each member's literal is its nearest preceding declaration in the same
  // `var` chain, which sits directly before the array.
  const before = file.slice(
    Math.max(0, declaration.index - 20000),
    declaration.index
  );
  const literals: string[] = [];
  for (const member of declaration[2].split(',')) {
    const found = [
      ...before.matchAll(
        new RegExp(`(?:var |,)${escapeName(member)}=(${STRING_LITERAL})`, 'g')
      ),
    ].at(-1);
    if (!found) return null;
    literals.push(found[1]);
  }
  return literals;
};

export const writeNoGlobalCacheScope = (
  oldFile: string,
  pristineFile: string
): string | null => {
  const stock = identityLiterals(pristineFile);
  const current = identityLiterals(oldFile);
  if (!stock || !current) {
    console.error(
      'patch: noGlobalCacheScope: failed to find the identity lines Claude Code checks'
    );
    return null;
  }
  if (
    stock.length === current.length &&
    stock.every((literal, i) => literal === current[i])
  ) {
    debug(
      'patch: noGlobalCacheScope: identity lines are stock; the global cache scope stays'
    );
    return oldFile;
  }

  const callers = new Set(
    [...oldFile.matchAll(GLOBAL_SCOPE_CALLER)].map(m => m[1])
  );
  if (callers.size !== 1) {
    console.error(
      `patch: noGlobalCacheScope: expected one function named in scope:X()?"global", found ${callers.size}`
    );
    return null;
  }
  const [name] = callers;

  const matches = [...oldFile.matchAll(PREDICATE)].filter(m => m[1] === name);
  if (matches.length === 0) {
    if (oldFile.includes(`function ${name}(){return!1}`)) {
      debug('patch: noGlobalCacheScope: predicate already answers false');
      return oldFile;
    }
    console.error(
      `patch: noGlobalCacheScope: failed to find the global-scope predicate ${name}`
    );
    return null;
  }
  if (matches.length > 1) {
    console.error(
      `patch: noGlobalCacheScope: the global-scope predicate ${name} matched ${matches.length} times`
    );
    return null;
  }

  const [match] = matches;
  const start = match.index!;
  const end = start + match[0].length;
  const replacement = `function ${name}(){return!1}`;
  const newFile = oldFile.slice(0, start) + replacement + oldFile.slice(end);
  showDiff(oldFile, newFile, replacement, start, end);
  return newFile;
};

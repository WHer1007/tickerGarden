import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const names = ['home', 'markets', 'create', 'trade', 'staking', 'rewards', 'stats', 'docs', 'privacy', 'terms'];
const template = (name: string): string => {
  const source = readFileSync(new URL(`../src/pages/${name}.ts`, import.meta.url), 'utf8');
  const match = source.match(/html\s*:\s*`([\s\S]*)`\s*,?\s*};\s*$/);
  assert.ok(match, `${name} has no page template`);
  return match[1]!;
};
const visibleText = (html: string): string => html
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ');

test('static page copy does not use the internal Meme asset label', () => {
  for (const name of names) {
    assert.doesNotMatch(visibleText(template(name)), /\bmeme\b/i, `${name} contains user-facing Meme copy`);
  }
});

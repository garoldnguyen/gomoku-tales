// The marks on the farm are plants that grow from seeds, never stones (docs/art-direction-v3.md).
// The status line, the skill errors and the notices after a skill must say so. A petrified plant
// does turn "to stone", which is the one place the word stays.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
  '../src/ui/targeting.js',
  '../src/ui/local-game.js',
  '../src/ui/online-game.js',
  '../src/ui/strings.js',
  '../src/ui/skill-info.js',
  '../src/logic/wind-rabbit-skills.js',
  '../src/logic/earth-bear-skills.js',
  '../src/logic/jade-serpent-skills.js',
];
const STRING = /(['"`])((?:\\.|(?!\1).)*)\1/g;

test('texts the player reads call the marks plants, not stones', () => {
  const found = [];
  for (const file of FILES) {
    const lines = readFileSync(new URL(file, import.meta.url), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // a comment
      for (const [, , text] of line.matchAll(STRING)) {
        if (/\bstones?\b/i.test(text.replace(/\bto stone\b/gi, ''))) found.push(`${file}:${index + 1}: ${text}`);
      }
    });
  }
  assert.deepEqual(found, []);
});

/**
 * The library sync patch is the only thing making the TV notice a title added on
 * another device, and it fails silently in two ways:
 *
 *  - hand-editing the patch leaves stale @@ line counts, so `git apply` rejects it
 *    and the build ships UNPATCHED while going green (this repo's oldest lesson);
 *  - the poll interval IS the latency, so quietly raising it back to "save
 *    traffic" undoes the fix without breaking anything visible.
 *
 * Run: node test/library-sync-patch.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const file = path.join(__dirname, '..', 'patches/stremio-web/0001-tv-library-sync.patch');
const lines = fs.readFileSync(file, 'utf8').split('\n');

let header = null;
let body = [];
let checked = 0;

function checkHunk() {
    if (!header) return;
    const old = body.filter((l) => l[0] === ' ' || l[0] === '-').length;
    const now = body.filter((l) => l[0] === ' ' || l[0] === '+').length;
    assert.strictEqual(old, header.old, `hunk @@ ${header.raw} claims ${header.old} old lines, body has ${old}`);
    assert.strictEqual(now, header.new, `hunk @@ ${header.raw} claims ${header.new} new lines, body has ${now}`);
    checked++;
}

for (const line of lines) {
    const m = /^@@ -\d+,(\d+) \+\d+,(\d+) @@/.exec(line);
    if (m) {
        checkHunk();
        header = { old: +m[1], new: +m[2], raw: line };
        body = [];
    } else if (header) {
        body.push(line);
    }
}
checkHunk();
assert.ok(checked >= 2, `expected to check both hunks, checked ${checked}`);

// A no-change sync is one datastoreMeta POST - measured 6.3 KB / ~200 ms against a
// 211-item account - so a short interval is cheap. Anything long is the old bug back.
const interval = /}, (\d+)\);/.exec(lines.filter((l) => /^\+.*}, \d+\);/.test(l))[0]);
assert.ok(interval, 'could not find the setInterval period in the patch');
assert.ok(+interval[1] <= 15000, `sync interval is ${interval[1]}ms - that is the latency the user sees`);

console.log(`library sync patch: ${checked} hunks consistent, interval ${interval[1]}ms`);

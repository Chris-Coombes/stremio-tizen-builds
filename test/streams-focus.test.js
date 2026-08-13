/**
 * After picking a provider from the stream filter, focus has to end up on the
 * stream list. Two things in tizen/templates/tizen-inject.js decide that, and
 * both failed silently -- focus just quietly ended up somewhere else on the page.
 *
 * Class chains below were read off the running app on the TV (stremio-web
 * v5.0.0-beta.31), element first then ancestors, not invented.
 * Run: node test/streams-focus.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'tizen/templates/tizen-inject.js'), 'utf8');

const STREAMS_LIST = src.match(/var STREAMS_LIST = '([^']+)';/)[1];
const STREAM_ROWS = src.match(/var STREAM_ROWS = '([^']+)';/)[1];

function hasClass(cls, part) {
    return cls.includes(part.match(/\[class\*="([^"]+)"\]/)[1]);
}

// chain[0] is the element itself, the rest are its ancestors outward.
function closest(chain, sel) {
    const parts = sel.split('>').map((s) => s.trim());
    for (let i = 0; i < chain.length; i++) {
        if (!hasClass(chain[i], parts[parts.length - 1])) continue;
        if (parts.length === 1) return true;
        if (chain[i + 1] && hasClass(chain[i + 1], parts[0])) return true;
    }
    return false;
}

const streamRow = [
    'label-container-XOyzm stream-container-JPdah button-container-zVLH6',
    'streams-container-bbSc4',
    'streams-list-Y1lCM streams-list-container-xYMJo',
    'metadetails-content-Uz5EV'
];

const filterButton = [
    'multiselect-button-XXdgA button-container-zVLH6',
    'multiselect-menu-qMdaj select-input-container-irGn_',
    'select-choices-wrapper-xGzfs',
    'streams-list-Y1lCM streams-list-container-xYMJo',
    'metadetails-content-Uz5EV'
];

assert.strictEqual(closest(streamRow, STREAM_ROWS), true, 'a stream row must count as a stream row');

// The trap. The filter renders INSIDE the stream list, so the old "is focus
// anywhere in the list" guard read focus sitting on the filter button as
// already-in-the-list and left it there.
assert.strictEqual(closest(filterButton, STREAMS_LIST), true,
    'the filter button really is inside the stream list -- that is why the list-wide guard was wrong');
assert.strictEqual(closest(filterButton, STREAM_ROWS), false,
    'the filter button must NOT count as being on a stream');

// And the guard has to be the row one, or the distinction above buys nothing.
assert.ok(/closest\(STREAM_ROWS\)/.test(src),
    'the leave-the-user-alone guard must test STREAM_ROWS, not the whole list');

// The other half: a title page has no tiles and no addon rows, so arming the
// catalog focus there walks off the end of firstResult() and lands on the IMDb
// button in the meta preview.
const closeBranch = src.match(/if \(dropdownWasOpen && !isOpen\) \{([\s\S]*?)\n {8}\}/)[1];
assert.ok(/#\/detail/.test(closeBranch) && /armStreamsFocus/.test(closeBranch),
    'closing a filter on #/detail must arm the streams focus, not the catalog focus');

console.log('streams focus: all cases pass');

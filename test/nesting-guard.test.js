/**
 * The nesting guard in tizen/templates/tizen-inject.js has to satisfy two
 * requirements that pull against each other, and getting it wrong is silent --
 * promotion still runs, it just does nothing, which on the device is
 * indistinguishable from the code not being there.
 *
 * Structures below were measured on a QE50Q80BATXXU, not invented.
 * Run: node test/nesting-guard.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'tizen/templates/tizen-inject.js'), 'utf8');

const guard = src.match(/var ancestor = el\.parentElement \?[\s\S]*?if \(ancestorIndex === '0' \|\| ancestorIndex === '-1'\) continue;\s*\}/);
assert(guard, 'could not find the nesting guard - has it been renamed?');

const NAV_SEL = src.match(/var NAV_SEL = \[([\s\S]*?)\]\.join\(','\);/)[1]
    .split('\n').map((s) => s.trim()).filter((s) => s.startsWith("'"))
    .map((s) => s.replace(/^'|',?$/g, '')).join(',');

function el(cls, ti, parent) {
    const node = {
        cls, ti, parentElement: parent || null,
        getAttribute: (k) => (k === 'tabindex' ? node.ti : null),
        matches(sel) {
            return sel.split(',').map((s) => s.trim()).some((s) => {
                const sub = s.match(/\[class\*="([^"]+)"\]/);
                const not = s.match(/:not\(\[class\*="([^"]+)"\]\)/);
                if (!sub) return s === '[tabindex="0"]' ? node.ti === '0' : false;
                if (!node.cls.includes(sub[1])) return false;
                if (not && node.cls.includes(not[1])) return false;
                return true;
            });
        },
        closest(sel) { let n = node; while (n) { if (n.matches(sel)) return n; n = n.parentElement; } return null; },
    };
    return node;
}

function skipped(node) {
    const ancestor = node.parentElement ? node.parentElement.closest('[tabindex="0"],' + NAV_SEL) : null;
    if (ancestor) {
        const ai = ancestor.getAttribute('tabindex');
        if (ai === '0' || ai === '-1') return true;
    }
    return false;
}

// Nested inside a control that is already focusable: must be skipped, or every
// film tile gains a second focus stop and crossing a row takes two presses each.
const tile = el('meta-item-QFHCh', '0');
assert.strictEqual(skipped(el('menu-label-container-ChuX8', '-1', tile)), true,
    'menu label inside a focusable tile should be skipped');

// Inside a plain layout container that only matches NAV_SEL by substring
// ("control-bar-buttonS-container" contains "control-bar-button"). It carries no
// tabindex, was never a candidate, and must not block its children -- this is
// what made the whole player control bar unreachable.
const barContainer = el('control-bar-buttons-container-SWhkU', null);
assert.strictEqual(skipped(el('control-bar-button-FQUsj', '-1', barContainer)), false,
    'player control buttons must stay promotable');

// Same shape, different page: the sidebar tabs.
const sidebar = el('vertical-nav-bar-container-x', null);
assert.strictEqual(skipped(el('nav-tab-button-tW6qT', '-1', sidebar)), false,
    'sidebar nav tabs must stay promotable');

console.log('nesting guard: all cases pass');

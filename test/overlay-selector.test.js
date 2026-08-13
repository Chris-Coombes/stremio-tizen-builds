/**
 * OVERLAY_SEL in tizen/templates/tizen-inject.js decides what counts as "an open
 * menu" and therefore what up/down and back do. Getting it wrong is silent and
 * total: matching the control bar meant every press in the player was captured
 * and cycled around the control bar buttons, so the subtitles menu could be
 * opened but never entered.
 *
 * Class names below are the real hashed ones from the built stylesheet of
 * stremio-web v5.0.0-beta.31, not invented.
 * Run: node test/overlay-selector.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'tizen/templates/tizen-inject.js'), 'utf8');

const MENU_LAYER = src.match(/var MENU_LAYER = '([^']+)';/)[1];
const OVERLAY_SEL = src.match(/var OVERLAY_SEL =([^;]*);/)[1]
    .replace(/MENU_LAYER/g, "'" + MENU_LAYER + "'")
    .split('+').map((s) => s.trim().replace(/^'|'$/g, '')).join('');

// Only the single-element branches are modelled. The multiselect branch is a
// descendant selector and needs a real tree; it is unchanged and the
// nesting-guard test covers that shape.
function matches(cls, sel) {
    return sel.split(',').map((s) => s.trim()).filter((s) => !s.includes(' ')).some((s) => {
        const sub = s.match(/\[class\*="([^"]+)"\]/);
        const not = s.match(/:not\(\[class\*="([^"]+)"\]\)/);
        if (!sub) return false;
        if (!cls.includes(sub[1])) return false;
        if (not && cls.includes(not[1])) return false;
        return true;
    });
}

// The bug. Always rendered at TV widths, holds the subtitles button, and comes
// before every real menu in document order -- so if this matches, openOverlay()
// returns it and nothing else is ever reachable.
assert.strictEqual(matches('control-bar-buttons-menu-container-M6L0_', OVERLAY_SEL), false,
    'the control bar button cluster must NOT count as an open menu');

// Every player menu carries menu-layer, so all of them are navigable. The audio
// menu is the one that proves the point: its own class is "audio-menu", which no
// *menu-container* pattern reaches.
[
    'layer-abc12 menu-layer-HZFG9 subtitles-menu-container-PxBRZ',
    'layer-abc12 menu-layer-HZFG9 audio-menu-qB4SQ',
    'layer-abc12 menu-layer-HZFG9 speed-menu-container-ABjzc',
    'layer-abc12 menu-layer-HZFG9 options-menu-container-qlzLt',
    'layer-abc12 menu-layer-HZFG9 statistics-menu-container-DhiHn'
].forEach((cls) => {
    assert.strictEqual(matches(cls, OVERLAY_SEL), true, cls + ' should count as an open menu');
});

// The account menu (Popup) is what the menu-container pattern was there for.
assert.strictEqual(matches('menu-container-B6cqK menu-direction-bottom-left-x', OVERLAY_SEL), true,
    'the account menu must stay navigable');

// closeOverlay routes player menus down a different path from the account menu,
// so MENU_LAYER must not catch the latter.
assert.strictEqual(matches('menu-container-B6cqK', MENU_LAYER), false,
    'MENU_LAYER must only select player menus');

console.log('overlay selector: all cases pass');

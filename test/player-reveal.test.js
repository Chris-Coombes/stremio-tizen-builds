/**
 * The remote's OK button must bring up the player controls.
 *
 * While a film plays, stremio-web hides the control bar at opacity 0 (the
 * player-container gets "overlayHidden-*") and only a mousemove on the container
 * brings it back. A remote never produces one, so OK did nothing visible and the
 * arrows moved focus between invisible buttons. Chris hit this 2026-11-14.
 *
 * This runs the REAL shim against a tiny fake DOM and presses keys at it, rather
 * than restating the logic. Class names are the ones measured on the TV
 * (player-container-wIELK overlayHidden-gyjIy, control-bar-button-*).
 *
 * Run: node test/player-reveal.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'tizen/templates/tizen-inject.js'), 'utf8');

// ── just enough DOM: [class*=], [tabindex=], :not(), comma lists, descendant ──
function simpleMatch(el, sel) {
    const nots = [];
    sel = sel.replace(/:not\(([^)]*)\)/g, (_, s) => { nots.push(s); return ''; });
    const attrs = [...sel.matchAll(/\[([a-z]+)([*]?)="([^"]*)"\]/g)];
    if (!attrs.length) return false;
    for (const [, name, star, val] of attrs) {
        const v = name === 'class' ? el.className : el.getAttribute(name);
        if (v == null || (star ? !v.includes(val) : v !== val)) return false;
    }
    return nots.every((n) => !simpleMatch(el, n));
}
function matches(el, sel) {
    return sel.split(',').some((part) => {
        const chain = part.trim().split(/\s+/);
        if (!simpleMatch(el, chain.pop())) return false;
        let a = el.parentElement;
        while (chain.length && a) { if (simpleMatch(a, chain[chain.length - 1])) chain.pop(); a = a.parentElement; }
        return !chain.length;
    });
}
class El {
    constructor(className, attrs = {}) {
        this.className = className; this.attrs = { ...attrs }; this.children = []; this.parentElement = null;
        this.events = [];
    }
    add(...kids) { kids.forEach((k) => { k.parentElement = this; this.children.push(k); }); return this; }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    getBoundingClientRect() { return { width: 100, height: 40, top: 900, left: 100 }; }
    matches(sel) { return matches(this, sel); }
    closest(sel) { let e = this; while (e) { if (e.matches(sel)) return e; e = e.parentElement; } return null; }
    all() { return this.children.flatMap((c) => [c, ...c.all()]); }
    querySelectorAll(sel) { return this.all().filter((e) => e.matches(sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    focus() { doc.activeElement = this; }
    dispatchEvent(ev) { this.events.push(ev.type); }
}

let doc, player, pause, subs;
const listeners = [];
function build(hidden) {
    pause = new El('control-bar-button-AAAAA button-container-BBBBB', { tabindex: '-1' });
    subs = new El('control-bar-button-AAAAA button-container-BBBBB', { tabindex: '-1' });
    player = new El('player-container-wIELK' + (hidden ? ' overlayHidden-gyjIy' : ''));
    const object = new El('', {});
    player.add(object, new El('control-bar-layer-CCCCC').add(
        new El('control-bar-buttons-container-DDDDD').add(pause, subs)));
    const root = new El('root').add(player);
    doc = {
        activeElement: object,                     // where AVPlay leaves focus
        querySelectorAll: (s) => root.querySelectorAll(s),
        querySelector: (s) => root.querySelector(s),
        addEventListener: (type, fn) => { if (type === 'keydown') listeners.push(fn); },
        createElement: () => new El(''),
        head: new El('head'),
    };
    doc.head.appendChild = () => {};
}
build(true);

const sandbox = {
    document: new Proxy({}, { get: (_, k) => doc[k], set: (_, k, v) => { doc[k] = v; return true; } }),
    window: { addEventListener() {} },
    location: { hash: '#/player/abc' },
    history: { back() {} },
    setInterval() {}, setTimeout() {},
    console: { log() {} },
    MouseEvent: class { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({}),
    Date,
};
vm.runInNewContext(src, sandbox);

function press(keyCode) {
    const code = { 13: 'Enter', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' }[keyCode];
    const e = { keyCode, code, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; } };
    for (const fn of listeners) { fn(e); if (e.stopped) break; }
    return e;
}

// 1. Hidden bar, focus on the video: OK shows the bar and lands on play/pause,
//    and is swallowed so it cannot also pause the film.
let e = press(13);
assert.ok(player.events.includes('mousemove'), 'OK must count as a mousemove so stremio-web shows the bar');
assert.strictEqual(doc.activeElement, pause, 'OK on a hidden bar must focus play/pause');
assert.ok(e.defaultPrevented, 'the revealing OK must not also activate anything');

// 2. Hidden bar, focus already on a button: the press only reveals.
build(true);
doc.activeElement = subs; subs.setAttribute('tabindex', '0');
e = press(13);
assert.ok(player.events.includes('mousemove'));
assert.ok(e.defaultPrevented, 'OK on an invisible button must not press it blind');
assert.strictEqual(doc.activeElement, subs, 'focus must stay on the button you were on');
e = press(39);
assert.ok(e.defaultPrevented, 'an arrow on a hidden bar must not move focus blind either');

// 3. Visible bar, focus on a button: keys pass straight through (native
//    navigation and Enter-to-click), but still keep the bar awake.
build(false);
doc.activeElement = pause; pause.setAttribute('tabindex', '0');
e = press(13);
assert.ok(!e.defaultPrevented, 'OK on a visible button must press it');
assert.ok(player.events.includes('mousemove'), 'every press must reset the 3 s auto-hide');
e = press(39);
assert.ok(!e.defaultPrevented, 'arrows on a visible bar must reach spatial navigation');
assert.strictEqual(e.code, '', 'stremio-web seeks on event.code ArrowRight; it must not see it');
assert.strictEqual(e.keyCode, 39, 'the polyfill navigates on keyCode, which must survive');
e = press(38);
assert.strictEqual(e.code, '', 'ArrowUp is the volume shortcut; hide it too');
e = press(13);
assert.strictEqual(e.code, 'Enter', 'OK is not a shortcut and must reach the button untouched');

// 4. Off the player route nothing happens.
build(true);
sandbox.location.hash = '#/';
e = press(13);
assert.ok(!player.events.includes('mousemove') && !e.defaultPrevented, 'only the player route is touched');

console.log('player reveal: all cases pass');

/**
 * "Down out of a text field goes to the first result" must apply to the SEARCH
 * bar and nowhere else.
 *
 * Unscoped, it fired in every text field on every page. firstResult() ends in a
 * content-area fallback -- the first [tabindex="0"] with x > 100 and y > 100 --
 * which on the login form matched the focused e-mail box ITSELF, so Down
 * re-focused the field you were already in and the password field below it was
 * unreachable with the remote. Chris hit this on a fresh install, 2026-11-03.
 *
 * Class names below are read off the built stylesheet of the installed build
 * (6f0e7aa.../styles/main.css), not invented:
 *   search bar      search-input-IQ0ZW text-input-hnLiz
 *   login/signup    credentials-text-input-ncrIR
 *   addon paste-URL addon-url-input-ucetZ
 *
 * Run: node test/search-down-scope.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'tizen/templates/tizen-inject.js'), 'utf8');

// Pull the real guard out of the shim rather than restating it here.
const m = src.match(/if \(!field\.matches\('(\[class\*="[^"]+"\])'\)\) return;/);
assert(m, 'search-bar scope guard missing from tizen-inject.js - was it removed?');
const SEL = m[1];

const sub = SEL.match(/\[class\*="([^"]+)"\]/)[1];
const matches = (cls) => cls.includes(sub);

// The guard must let the search bar through...
assert.strictEqual(matches('search-input-IQ0ZW text-input-hnLiz'), true,
    'search bar must still jump Down into the results');
assert.strictEqual(matches('search-input-bAgAh'), true, 'other search-bar variant');
assert.strictEqual(matches('search-input-Q18HV'), true, 'other search-bar variant');

// ...and stop at every other text field, or the remote cannot leave it.
assert.strictEqual(matches('credentials-text-input-ncrIR'), false,
    'login/signup field must fall through to native spatial navigation');
assert.strictEqual(matches('credentials-text-input-QMCZz'), false,
    'the second credentials field must fall through too');
assert.strictEqual(matches('addon-url-input-ucetZ'), false,
    'the addon paste-URL field must fall through');
assert.strictEqual(matches('text-input-hnLiz'), false,
    'a bare text input is not a search bar');
assert.strictEqual(matches('number-input-igJ35'), false, 'settings number field');

// The substring trap this project has hit four times: assert no container class
// in the built stylesheet would be caught by the selector by coincidence.
const containers = [
    'selectable-inputs-container-hR3or',
    'select-input-container-H1VZ1',
    'color-input-container-FAQiP',
    'configure-input-container-IqUdN',
];
containers.forEach((c) => assert.strictEqual(matches(c), false,
    `container "${c}" must not match the search-input selector`));

// The guard has to sit AFTER the INPUT/TEXTAREA check and BEFORE firstResult(),
// or it either never runs or runs too late to prevent the hijack.
const order = src.indexOf("field.matches('" + SEL + "')");
const tagCheck = src.indexOf("field.tagName !== 'TEXTAREA'");
const call = src.indexOf('var first = firstResult();');
assert(tagCheck > -1 && call > -1, 'handler shape changed');
assert(tagCheck < order && order < call,
    'scope guard must be between the tagName check and firstResult()');

console.log('search-down scope: all cases pass');

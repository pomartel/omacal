const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const Fr = require('../i18n/Fr.js');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n/fr.json'), 'utf8'));
const vm = require('node:vm');
const backend = vm.createContext({ Fr });
vm.runInContext(fs.readFileSync(path.join(root, 'i18n/Backend.js'), 'utf8').replace(/^\.import .*\n/gm, ''), backend);

test('backend presentation translates known messages and preserves unknown details', () => {
    assert.equal(backend.message('Give the event a title.'), 'Donnez un titre à l’événement.');
    assert.equal(backend.message('Google did not accept that (HTTP 403).'), 'Google a refusé cette opération (HTTP 403).');
    assert.equal(backend.message('hey exited with status 2.'), 'hey s’est arrêté avec le code 2.');
    const zone = 'Été $& %2 <b>ê</b>';
    assert.equal(backend.message('“' + zone + '” is not a time zone I know.'), 'Le fuseau horaire « ' + zone + ' » est inconnu.');
    assert.equal(backend.message('Unknown upstream failure: 123'), 'Unknown upstream failure: 123');
    assert.equal(backend.message('Google did not accept that (HTTP 403)X'), 'Google did not accept that (HTTP 403)X');
    assert.equal(backend.message(''), '');
});

test('the synchronous adapter matches the single editable catalog', () => {
    execFileSync('python3', [path.join(root, 'tools/build-translations'), '--check']);
    assert.deepEqual(Fr.catalog, catalog);
});

test('every translated UI/model reference has a French message', () => {
    function visit(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (['.git', 'tests', 'tools', 'i18n'].includes(entry.name)) continue;
            const filename = path.join(dir, entry.name);
            if (entry.isDirectory()) { visit(filename); continue; }
            if (!/\.(qml|js)$/.test(filename)) continue;
            const source = fs.readFileSync(filename, 'utf8');
            for (const match of source.matchAll(/Fr\.t\("([^"]+)"/g)) {
                assert.equal(typeof catalog[match[1]], 'string', filename + ': ' + match[1]);
            }
        }
    }
    visit(root);
});

test('substitutions preserve accents and treat user text literally', () => {
    assert.equal(Fr.t('text.annuler'), 'Annuler');
    const key = Object.keys(catalog).find(key => catalog[key].includes('%1'));
    const input = 'Été à Noël: $& %2 <b>ê</b>';
    assert.equal(Fr.t(key, input), catalog[key].replace(/%1/g, () => input));
    assert.equal(Fr.t('missing.key'), 'missing.key');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const Fr = require('../i18n/Fr.js');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n/fr.json'), 'utf8'));

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

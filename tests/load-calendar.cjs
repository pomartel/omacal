// QML imports are resolved explicitly when exercising the same model in Node.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const filename = path.resolve(__dirname, '../Calendar.js');
const model = new Module(filename, module);
model.filename = filename;
model.paths = Module._nodeModulePaths(path.dirname(filename));
model._compile('const Fr = require("./i18n/Fr.js");\n' +
    fs.readFileSync(filename, 'utf8').replace(/^\.import.*$/gm, ''), filename);
module.exports = model.exports;

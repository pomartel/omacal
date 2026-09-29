const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const Cal = require('../Calendar.js')
const source = fs.readFileSync(path.join(__dirname, '../BarWidget.qml'), 'utf8')
const initialization = source.match(/  function initializeCalendar\(\) \{[\s\S]*?\n  \}/)[0]
const restore = source.match(/  function restoreCache\(text\) \{[\s\S]*?\n  \}/)[0]
const completed = source.match(/  Component.onCompleted: (Qt\.callLater\(root\.initializeCalendar\))/)[1]
let deferred
let refreshes = 0
const root = { backend: {}, refreshCalendar() { refreshes++ }, rebuildIndex() {} }
const cacheProcess = { running: false }
const context = vm.createContext({ root, cacheProcess, Cal,
  rebuildIndex() {}, Qt: { callLater(fn) { deferred = fn } } })
vm.runInContext(initialization + '\n' + restore, context)
root.initializeCalendar = context.initializeCalendar

// QML completes before the bar supplies the Google account settings.
vm.runInContext(completed, context)
assert.equal(refreshes, 0)
assert.equal(cacheProcess.running, false)
root.backend = { cacheCommand: ['python3', 'google.py', 'cache'] }
deferred()
assert.equal(cacheProcess.running, true)
assert.equal(refreshes, 0)

// A restored snapshot is immediately usable without any successful network call.
const at = Date.now() / 1000
context.restoreCache(JSON.stringify({ version: 1, calendars: [], weeks: {
  '2026-09-28': { at, events: [{ id: 'cached-event', title: 'Cached event',
    all_day: true, starts_at: '2026-09-29', ends_at: '2026-09-30' }] }
} }))
assert.equal(root.loaded, true)
assert.equal(root.weekCache['2026-09-28'].events.length, 1)
assert.equal(root.weekCache['2026-09-28'].at, at * 1000)
assert.equal(root.weekCache['2026-09-28'].cached, true)

console.log('Cache startup tests passed')

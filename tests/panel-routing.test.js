const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../BarWidget.qml'), 'utf8')
const route = source.match(/  function routePanelCommand\(method, focused\) \{[\s\S]*?\n  \}/)[0]
let calls = []
function widget(screen, opened = false, width = 100) {
  return { panelScreenName: screen, opened, width, height: 26,
    togglePanel() { calls.push(screen); this.opened = !this.opened } }
}
const laptop = widget('eDP-1')
const external = widget('DP-1')
const placeholder = widget('DP-1', false, 0)
const root = laptop
root.moduleName = 'pomartel.omacal'
root.bar = { moduleWidgets: () => [laptop, external, placeholder] }
const context = vm.createContext({ root })
vm.runInContext(route, context)

context.routePanelCommand('togglePanel', 'DP-1')
assert.deepEqual(calls, ['DP-1'])
// Closing follows the open panel even after focus moves to another output.
context.routePanelCommand('togglePanel', 'eDP-1')
assert.deepEqual(calls, ['DP-1', 'DP-1'])
context.routePanelCommand('togglePanel', 'eDP-1')
assert.deepEqual(calls, ['DP-1', 'DP-1', 'eDP-1'])
laptop.opened = false
root.bar = null
context.routePanelCommand('togglePanel', '')
assert.equal(calls.at(-1), 'eDP-1')

for (const [name, method] of Object.entries({open:'open', close:'close', show:'open', hide:'close', toggle:'togglePanel', newEvent:'newEvent', settings:'openSettings'})) {
  assert.ok(source.includes(`function ${name}(): void { root.invokeFocusedPanel("${method}") }`))
}
console.log('Panel routing tests passed')

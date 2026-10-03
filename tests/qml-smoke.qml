import QtQuick
import Quickshell
import "plugin" as Plugin
import "plugin/Calendar.js" as Cal

ShellRoot {
  id: root
  property bool submitted: false
  property bool keysChecked: false
  Plugin.Panel { id: calendarPanel }
  function press(key, text, modifiers) {
    var event = { key: key, text: text || "", modifiers: modifiers || 0, accepted: false }
    calendarPanel.handleCalendarKey(event)
    return event.accepted
  }
  function checkKeys() {
    calendarPanel.selectedKey = "2026-01-31"
    calendarPanel.viewYear = 2026
    calendarPanel.viewMonth = 0
    press(Qt.Key_Right)
    if (calendarPanel.selectedKey !== "2026-02-01" || calendarPanel.viewMonth !== 1) throw new Error("Arrow did not select next day across month")
    press(Qt.Key_K, "k")
    if (calendarPanel.selectedKey !== "2026-01-25") throw new Error("K did not select previous week")
    press(Qt.Key_J, "j")
    press(Qt.Key_H, "h")
    press(Qt.Key_L, "l")
    if (calendarPanel.selectedKey !== "2026-02-01") throw new Error("Vim day/week navigation failed")
    press(Qt.Key_Right, "", Qt.ControlModifier)
    if (calendarPanel.viewMonth !== 2 || calendarPanel.selectedKey !== "2026-03-01") throw new Error("Ctrl+Right did not move selection with month")
    press(Qt.Key_K, "", Qt.ControlModifier)
    if (calendarPanel.viewMonth !== 1 || calendarPanel.selectedKey !== "2026-02-01") throw new Error("Ctrl+K did not move selection with month")
    press(Qt.Key_BracketRight, "]")
    press(Qt.Key_BraceRight, "}")
    if (calendarPanel.viewMonth !== 2 || calendarPanel.viewYear !== 2027) throw new Error("Month/year shortcuts changed")
    for (var example of [
      ["2026-01-31", 2026, 0, Qt.Key_Right, "2026-02-28"],
      ["2028-01-31", 2028, 0, Qt.Key_Down, "2028-02-29"],
      ["2026-03-31", 2026, 2, Qt.Key_Left, "2026-02-28"],
      ["2026-12-15", 2026, 11, Qt.Key_Right, "2027-01-15"],
      ["2026-01-15", 2026, 0, Qt.Key_Up, "2025-12-15"]
    ]) {
      calendarPanel.selectedKey = example[0]
      calendarPanel.viewYear = example[1]
      calendarPanel.viewMonth = example[2]
      press(example[3], "", Qt.ControlModifier)
      if (calendarPanel.selectedKey !== example[4]) throw new Error("Month selection failed: " + example[0])
      var selected = Cal.dateFromKey(calendarPanel.selectedKey)
      if (calendarPanel.viewYear !== selected.getFullYear() || calendarPanel.viewMonth !== selected.getMonth())
        throw new Error("Selected date is outside displayed month")
    }
    press(Qt.Key_Home)
    if (calendarPanel.selectedKey !== calendarPanel.todayKey) throw new Error("Home did not return to today")
    press(Qt.Key_Question, "?")
    if (!calendarPanel.keyboardHelpVisible) throw new Error("Help did not open")
    press(Qt.Key_Question, "?")
    if (calendarPanel.keyboardHelpVisible) throw new Error("Help did not close")
    calendarPanel.composing = true
    if (press(Qt.Key_Left) || press(Qt.Key_Question, "?")) throw new Error("Panel intercepted form typing")
    calendarPanel.composing = false
    calendarPanel.showingSettings = true
    if (press(Qt.Key_Home)) throw new Error("Panel intercepted settings typing")
    calendarPanel.showingSettings = false
  }
  property bool rangeStarted: false
  property bool navigationStarted: false
  property var rangeWeeks: []
  Plugin.BarWidget {
    id: widget
    settings: ({ googleAccount: "calendar@example.test", notifications: false })
    onWriteFinished: function(ok, message) {
      if (!ok) throw new Error("Fixture write failed: " + message)
      quickAdd.submit({title: "Fixture write", date: "2026-09-28", allDay: true,
                       calendarId: "calendar@example.test"})
    }
  }
  Plugin.QuickAdd {
    id: quickAdd
    shell: QtObject {
      property var barConfig: ({ layout: { center: [{ id: "pomartel.omacal", googleAccount: "calendar@example.test" }] } })
      function hide(id) {
        if (quickAdd.error !== "" || quickAdd.busy) throw new Error("Quick-add write did not finish")
        console.log("OMACAL_QML_SMOKE_OK")
        Qt.quit()
      }
    }
  }
  Plugin.QuickAdd { id: defaultQuickAdd }
  Plugin.EventForm {
    id: form
    calendars: widget.writableCalendars
    defaultCalendarId: "calendar@example.test"
  }
  Timer {
    interval: 100
    running: true
    repeat: true
    onTriggered: {
      if (!root.keysChecked) { root.checkKeys(); root.keysChecked = true }
      if (!widget.backendChecked || widget.loading || !widget.loaded || widget.calendars.length === 0 || root.submitted) return
      if (widget.lastError !== "") throw new Error(widget.lastError)
      if (widget.events.length === 0) throw new Error("No fixture events")
      if (widget.events[0].calendarId !== "calendar@example.test") throw new Error("Lost calendar ID")
      if (form.calendarId !== "calendar@example.test") throw new Error("Form lost calendar ID")
      if (quickAdd.backend.info.id !== "google") throw new Error("Quick add uses wrong backend")
      if (defaultQuickAdd.backend.info.id !== "google") throw new Error("Default Google backend changed")
      if (!root.rangeStarted) {
        var restored = widget.weekCache["2020-01-06"]
        if (!restored || !restored.cached || restored.events.length !== 1) throw new Error("Startup cache was not restored")
        if (widget.cacheNote("2020-01-06").indexOf("Données en cache") === -1) throw new Error("Cached data not labeled")
        var current = widget.weekCache[widget.baseWeeks()[0]]
        if (!current || current.cached) throw new Error("Background fetch did not replace cached data")
        root.rangeStarted = true
        var weeks = []
        for (var i = 0; i < 20; i++) weeks.push(Cal.addDays("2025-01-06", i * 7))
        root.rangeWeeks = weeks
        widget.visibleWeeks = weeks
        widget.requestWeeks(weeks, true)
        return
      }
      if (widget.loading || widget.queuedWeeks.length > 0) return
      for (var j = 0; j < root.rangeWeeks.length; j++)
        if (!widget.weekIsFresh(root.rangeWeeks[j])) throw new Error("Large range lost a week")
      if (!root.navigationStarted) {
        root.navigationStarted = true
        for (var month = 0; month < 5; month++) {
          var page = []
          for (var day = 0; day < 6; day++) page.push(Cal.addDays("2024-01-01", (month * 6 + day) * 7))
          widget.showWeeks(page)
          root.rangeWeeks = page
        }
        var keep = widget.baseWeeks().concat(root.rangeWeeks)
        for (var q = 0; q < widget.queuedWeeks.length; q++)
          if (keep.indexOf(widget.queuedWeeks[q]) === -1) throw new Error("Obsolete month still queued")
        return
      }
      for (var monthIndex = 0; monthIndex < 12; monthIndex++) {
        var frenchDay = Cal.keyForDate(new Date(2027, monthIndex, 15))
        if (Cal.parseDay(form.dayText(frenchDay), "2026-09-28") !== frenchDay)
          throw new Error("French form date did not round-trip: " + form.dayText(frenchDay))
      }
      if (calendarPanel.weekdayLabel(1) !== "LUN.") throw new Error("Weekday is not French")
      var cachedCount = widget.events.length
      widget.applyWeeks(1, '{"ok":false,"error":"Invalid week range."}')
      if (widget.lastError !== "Invalid week range.") throw new Error("Backend error was hidden")
      if (widget.events.length !== cachedCount) throw new Error("Fetch error discarded cached events")
      root.submitted = true
      if (!widget.addEvent({title: "Fixture write", date: "2026-09-28", allDay: true,
                           calendarId: form.calendarId})) throw new Error("Write did not start")
    }
  }
}

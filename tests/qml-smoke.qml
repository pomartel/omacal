import QtQuick
import Quickshell
import "plugin" as Plugin
import "plugin/Calendar.js" as Cal

ShellRoot {
  id: root
  property bool submitted: false
  property bool rangeStarted: false
  property bool navigationStarted: false
  property var rangeWeeks: []
  Plugin.BarWidget {
    id: widget
    settings: ({ backend: "google", googleAccount: "calendar@example.test", notifications: false })
    onWriteFinished: function(ok, message) {
      if (!ok) throw new Error("Fixture write failed: " + message)
      quickAdd.submit({title: "Fixture write", date: "2026-09-28", allDay: true,
                       calendarId: "calendar@example.test"})
    }
  }
  Plugin.QuickAdd {
    id: quickAdd
    shell: QtObject {
      property var barConfig: ({ layout: { center: [{ id: "pomartel.omacal", backend: "google", googleAccount: "calendar@example.test" }] } })
      function hide(id) {
        if (quickAdd.error !== "" || quickAdd.busy) throw new Error("Quick-add write did not finish")
        console.log("OMACAL_QML_SMOKE_OK")
        Qt.quit()
      }
    }
  }
  Plugin.QuickAdd { id: heyQuickAdd }
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
      if (!widget.loaded || widget.calendars.length === 0 || root.submitted) return
      if (widget.lastError !== "") throw new Error(widget.lastError)
      if (widget.events.length === 0) throw new Error("No fixture events")
      if (widget.events[0].calendarId !== "calendar@example.test") throw new Error("Lost calendar ID")
      if (form.calendarId !== "calendar@example.test") throw new Error("Form lost calendar ID")
      if (quickAdd.backend.info.id !== "google") throw new Error("Quick add uses wrong backend")
      if (heyQuickAdd.backend.info.id !== "hey") throw new Error("Default HEY backend changed")
      if (widget.capabilities.watch || widget.capabilities.timeTracking) throw new Error("Wrong capabilities")
      if (!root.rangeStarted) {
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

import QtQuick
import Quickshell
import "plugin" as Plugin
import "plugin/Calendar.js" as Cal

ShellRoot {
  id: root
  property bool started: false
  property var targetEvent: null
  property int requests: 0
  readonly property bool expectFailure: Quickshell.env("OMACAL_FIXTURE_DELETE_FAIL") === "1"
  Plugin.BarWidget {
    id: widget
    settings: ({ backend: "google", googleAccount: "calendar@example.test", notifications: false })
    onWriteFinished: function(ok, message) {
      if (ok === root.expectFailure) throw new Error("Unexpected delete result: " + message)
      if (widget.writing || widget.deletingEventKey !== "") throw new Error("Delete lock not released")
      var present = widget.events.some(function(event) { return event.key === root.targetEvent.key })
      if (root.expectFailure) {
        if (!present || widget.writeError === "") throw new Error("Failed delete lost event or error")
        if (card.busy) throw new Error("Failed delete cannot be retried")
      } else {
        if (present) throw new Error("Successful delete still visible while refresh runs")
        // Simulate an older in-flight fetch completing after the deletion.
        var week = Cal.weekStartKey(root.targetEvent.startsAt.substr(0, 10))
        var raw = { id: root.targetEvent.seriesId, calendar_id: root.targetEvent.calendarId,
          starts_at: root.targetEvent.startsAt, ends_at: root.targetEvent.endsAt,
          title: root.targetEvent.title, writable: true }
        widget.applyWeeks(0, JSON.stringify({ week: week, events: [raw] }))
        if (widget.events.some(function(event) { return event.key === root.targetEvent.key }))
          throw new Error("Old refresh resurrected deleted event")
        if (widget.deleteEvent(root.targetEvent, week)) throw new Error("Confirmed deletion submitted twice")
      }
      if (root.requests !== 1) throw new Error("Confirmation emitted twice")
      console.log("OMACAL_DELETE_SMOKE_OK")
      Qt.quit()
    }
  }
  Plugin.EventCard {
    id: card
    event: root.targetEvent
    busy: !!root.targetEvent && widget.deletingEventKey === root.targetEvent.key
    onDeleteRequested: {
      root.requests++
      if (!widget.deleteEvent(root.targetEvent, root.targetEvent.startsAt.substr(0, 10)))
        throw new Error("First delete rejected")
    }
  }
  Timer {
    interval: 100
    running: true
    repeat: true
    onTriggered: {
      if (root.started || !widget.backendChecked || widget.loading || widget.events.length === 0) return
      root.started = true
      root.targetEvent = widget.events[0]
      card.confirming = true
      card.confirmDeletion()
      if (!card.busy || !widget.writing) throw new Error("Delete was not locked immediately")
      card.confirmDeletion()
      if (widget.deleteEvent(root.targetEvent, root.targetEvent.startsAt.substr(0, 10)))
        throw new Error("Duplicate request accepted")
      if (!card.busy || root.requests !== 1) throw new Error("Duplicate click released delete lock")
    }
  }
}

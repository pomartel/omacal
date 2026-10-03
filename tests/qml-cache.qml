import QtQuick
import Quickshell
import "plugin" as Plugin

ShellRoot {
  Plugin.BarWidget {
    id: widget
    settings: ({ googleAccount: "calendar@example.test", notifications: false })
  }
  Timer {
    interval: 100
    running: true
    repeat: true
    onTriggered: {
      if (!widget.backendChecked) return
      if (widget.backendMode !== "") throw new Error("Offline fixture unexpectedly connected")
      if (!widget.loaded || widget.events.length === 0) throw new Error("Offline restart lost cached events")
      if (!widget.weekCache["2020-01-06"].cached) throw new Error("Offline data not marked cached")
      if (widget.calendars.length === 0) throw new Error("Offline restart lost calendar names")
      if (widget.lastError === "") throw new Error("Offline error was hidden")
      console.log("OMACAL_CACHE_SMOKE_OK")
      Qt.quit()
    }
  }
}

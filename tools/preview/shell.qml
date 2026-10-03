// Renders OmaCal's real panel, quick-add form and settings with a made-up
// calendar, for the README and release screenshots. No backend runs: a
// stand-in host serves fictional events, so no account is read and nothing
// is written. Run through tools/render-screenshots.
import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "plugin" as Plugin
import "plugin/Calendar.js" as Cal

ShellRoot {
  id: shell

  readonly property string outDir: Quickshell.env("OMACAL_PREVIEW_OUT")
  // OMACAL_PREVIEW_TIME=HH:MM renders today at that time (the launch video
  // uses 10:40); otherwise it is rendered at the current time.
  readonly property date now: {
    var d = new Date()
    var at = /^(\d{1,2}):(\d{2})$/.exec(Quickshell.env("OMACAL_PREVIEW_TIME") || "")
    if (at) d.setHours(parseInt(at[1], 10), parseInt(at[2], 10), 0, 0)
    return d
  }
  readonly property string todayKey: Cal.keyForDate(now)

  // ---- A fictional calendar, laid out around today.
  function at(dayOffset, hours, minutes) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hours, minutes)
    return d.toISOString()
  }
  function day(dayOffset) {
    return Cal.addDays(todayKey, dayOffset) + "T00:00:00Z"
  }
  function timed(id, title, calendar, color, dayOffset, h, m, minutes, extra) {
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m)
    var e = { id: id, title: title, calendar: calendar, color: color, all_day: false,
      starts_at: start.toISOString(), ends_at: new Date(start.getTime() + minutes * 60000).toISOString(),
      reminders: [new Date(start.getTime() - 15 * 60000).toISOString()] }
    for (var k in extra || {}) e[k] = extra[k]
    return e
  }
  function allDay(id, title, calendar, color, dayOffset, days) {
    return { id: id, title: title, calendar: calendar, color: color, all_day: true,
      starts_at: day(dayOffset), ends_at: day(dayOffset + (days || 0)), reminders: [] }
  }

  readonly property var sampleEvents: Cal.normalizeEvents([
    allDay(1, "Sam's birthday", "Family", "#fe9a99", 0),
    timed(2, "Team standup", "Work", "#6baffc", 0, 9, 30, 15),
    timed(3, "Design review: onboarding", "Work", "#6baffc", 0, 11, 0, 90, { location: "Studio 3" }),
    timed(4, "Lunch with Maya", "Friends", "#f6da93", 0, 13, 0, 60, { location: "Café Luna" }),
    timed(5, "Climbing", "Health", "#a9e8a0", 0, 18, 30, 90, { location: "Boulderhalle" }),
    timed(6, "Team standup", "Work", "#6baffc", 1, 9, 30, 15),
    timed(7, "Dentist", "Health", "#a9e8a0", 1, 16, 0, 45),
    timed(8, "Team standup", "Work", "#6baffc", 2, 9, 30, 15),
    timed(9, "Book club", "Friends", "#f6da93", 2, 19, 0, 120),
    timed(10, "Quarterly planning", "Work", "#6baffc", 3, 10, 0, 180),
    timed(11, "Dinner at Nonna's", "Family", "#fe9a99", 3, 19, 30, 120),
    timed(12, "Yoga", "Health", "#a9e8a0", 4, 8, 0, 60),
    timed(13, "Flight BER → LIS", "Travel", "#aefbec", 5, 7, 40, 225),
    allDay(14, "Lisbon", "Travel", "#aefbec", 5, 3),
    timed(15, "Tram 28 and pastéis", "Friends", "#f6da93", 6, 11, 0, 120),
    timed(16, "Flight LIS → BER", "Travel", "#aefbec", 7, 18, 5, 215),
    timed(17, "Team standup", "Work", "#6baffc", -3, 9, 30, 15),
    timed(18, "Launch retro", "Work", "#6baffc", -3, 15, 0, 60),
    timed(19, "Run", "Health", "#a9e8a0", -2, 7, 0, 45),
    allDay(20, "Mum visiting", "Family", "#fe9a99", -6, 2),
    timed(21, "Climbing", "Health", "#a9e8a0", -5, 18, 30, 120),
    timed(22, "Concert: The Blue Hours", "Friends", "#f6da93", -8, 20, 0, 150),
    timed(23, "1:1 with Priya", "Work", "#6baffc", 8, 14, 0, 30),
    timed(24, "Team standup", "Work", "#6baffc", 9, 9, 30, 15),
    timed(25, "Pottery class", "Hobbies", "#cdb6fb", 9, 18, 0, 120),
    timed(26, "Pottery class", "Hobbies", "#cdb6fb", 2, 18, 0, 120),
    timed(27, "Haircut", "Personal", "#dcc1a0", 10, 12, 0, 45),
    timed(28, "Pottery class", "Hobbies", "#cdb6fb", -5, 18, 0, 120),
    timed(29, "Board game night", "Friends", "#f6da93", 11, 19, 0, 180),
    timed(30, "Design review: settings", "Work", "#6baffc", 11, 11, 0, 60),
    timed(31, "Team standup", "Work", "#6baffc", -10, 9, 30, 15),
    timed(32, "Pottery class", "Hobbies", "#cdb6fb", -12, 18, 0, 120),
    allDay(33, "Berlin half marathon", "Health", "#a9e8a0", -13),
    timed(34, "Brunch with the Kims", "Friends", "#f6da93", -14, 11, 0, 120),
    timed(35, "Sprint demo", "Work", "#6baffc", -17, 16, 0, 60),
    timed(36, "Parents' anniversary dinner", "Family", "#fe9a99", -19, 19, 0, 150),
    timed(37, "Yoga", "Health", "#a9e8a0", -20, 8, 0, 60),
    timed(38, "Team offsite", "Work", "#6baffc", -22, 9, 0, 480),
    timed(39, "Picnic at Tempelhof", "Friends", "#f6da93", -23, 13, 0, 180),
    timed(40, "Car service", "Personal", "#dcc1a0", -25, 8, 30, 60),
    timed(41, "Climbing", "Health", "#a9e8a0", -26, 18, 30, 120),
    timed(42, "Team standup", "Work", "#6baffc", -24, 9, 30, 15)
  ])

  readonly property var sampleCalendars: [
    { id: 1, name: "Work", color: "#6baffc", owned: true },
    { id: 2, name: "Family", color: "#fe9a99", owned: true },
    { id: 3, name: "Friends", color: "#f6da93", owned: true },
    { id: 4, name: "Health", color: "#a9e8a0", owned: true },
    { id: 5, name: "Travel", color: "#aefbec", owned: true },
    { id: 6, name: "Hobbies", color: "#cdb6fb", owned: true },
    { id: 7, name: "Personal", color: "#dcc1a0", owned: true }
  ]

  // ---- Stand-ins for the bar and for BarWidget's calendar state.
  QtObject {
    id: fakeBar
    property string position: "top"
    property int barSize: 40
    property var activePopout: null
    property var clickTargets: []
    property color barForeground: Color.foreground
    property color foreground: Color.foreground
    property string fontFamily: Style.font.family
    property var shell: QtObject { function updateEntryInline(id, entry) { return true } }
    function requestPopout(key) { activePopout = key }
    function releasePopout(key) { if (activePopout === key) activePopout = null }
    function targetBelongsToWindow(target, window) { return false }
    function switchPanelFrom(item, direction) { return false }
    function setCenterHoverRevealSuppressed(value) {}
  }

  QtObject {
    id: host
    property var settings: ({ id: "pomartel.omacal", barEvent: "soon" })
    property date displayDate: shell.now
    property bool hour24: true
    property var events: shell.sampleEvents
    property var byDay: Cal.indexByDay(shell.sampleEvents)
    property var calendars: shell.sampleCalendars
    property var writableCalendars: shell.sampleCalendars
    property bool writing: false
    property string writeError: ""
    property string lastError: ""
    property bool loaded: true
    property bool loading: false
    property string backendMode: "google"
    property string backendName: "Google Agenda"
    signal writeFinished(bool ok, string message)
    function showWeeks(keys) {}
    function refreshCalendar(force) {}
    function dayUrl(key) { return "" }
    function modeNote() { return "Calendars selected in Google Agenda are displayed." }
    function openUrl(url) {}
    function addEvent(form) { return false }
    function deleteEvent(event, key) { return false }
  }

  // A bar-shaped strip across the top of the screen, holding the anchor the
  // panel opens under. Layer-shell, so nothing on the desktop is retiled.
  PanelWindow {
    id: strip
    anchors { top: true; left: true; right: true }
    implicitHeight: fakeBar.barSize
    exclusionMode: ExclusionMode.Ignore
    color: "transparent"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "omacal-preview"

    Item {
      id: anchor
      anchors.centerIn: parent
      width: 200
      height: parent.height
    }
  }

  Plugin.Panel {
    id: panel
    bar: fakeBar
    anchorItem: anchor
    hostWidget: host
    settings: host.settings
  }

  // The quick-add card, as QuickAdd.qml draws it, filled in.
  PanelWindow {
    id: cardWindow
    visible: false
    anchors { top: true; left: true }
    margins { top: 80; left: 80 }
    implicitWidth: card.width
    implicitHeight: card.height
    exclusionMode: ExclusionMode.Ignore
    color: "transparent"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "omacal-preview-card"

    Rectangle {
      id: card
      width: Style.space(480)
      height: form.implicitHeight + Style.space(36)
      color: Color.popups.background
      border.color: Color.popups.border
      border.width: 1
      radius: Style.cornerRadius

      Plugin.EventForm {
        id: form
        anchors.fill: parent
        anchors.margins: Style.space(18)
        todayKey: shell.todayKey
        calendars: shell.sampleCalendars
        defaultCalendarId: 1
        foreground: Color.popups.text
      }
    }
  }

  // The clock label as the bar shows it with an event close, in the bar's
  // own button.
  PanelWindow {
    id: labelWindow
    visible: false
    anchors { top: true; left: true }
    margins { top: 20; left: 80 }
    implicitWidth: labelBox.width
    implicitHeight: labelBox.height
    exclusionMode: ExclusionMode.Ignore
    color: "transparent"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "omacal-preview-label"

    Rectangle {
      id: labelBox
      width: labelButton.implicitWidth + 48
      height: 40
      color: Color.background

      WidgetButton {
        id: labelButton
        anchors.centerIn: parent
        bar: fakeBar
        text: "󰃭 Design review: onboarding · in 12m   " + Qt.formatDateTime(shell.now, "ddd d MMM") + " 10:48"
        horizontalMargin: 8.75
        verticalPadding: 8.75
      }
    }
  }

  function findByProperty(item, name) {
    if (!item) return null
    if (item[name] !== undefined && item.hasOwnProperty && item.hasOwnProperty(name)) return item
    var kids = item.data || item.children || []
    for (var i = 0; i < kids.length; i++) {
      var found = findByProperty(kids[i], name)
      if (found) return found
    }
    return null
  }

  function save(item, name) {
    // Twice the on-screen size, for sharp images on any display.
    item.grabToImage(function(result) { result.saveToFile(shell.outDir + "/" + name) },
      Qt.size(item.width * 2, item.height * 2))
  }

  Timer {
    interval: 700
    running: true
    repeat: true
    property int phase: 0
    onTriggered: {
      phase++
      var popup = shell.findByProperty(panel, "cardOrigin")
      // The popup's card: the bordered surface its content sits in.
      var cardItem = popup ? popup.contentItem[0] : null
      while (cardItem && cardItem.borderSpec === undefined) cardItem = cardItem.parent
      if (phase === 1) panel.open()
      // Waits for the popup to map and lay out before grabbing it.
      if ((phase === 3 || phase === 6) && (!cardItem || cardItem.height < 100)) {
        phase--
        return
      }
      if (phase === 3) shell.save(cardItem, "panel-full.png")
      if (phase === 4) panel.openSettings()
      if (phase === 6) shell.save(cardItem, "settings-full.png")
      if (phase === 7) {
        panel.closeSettings()
        panel.close()
        cardWindow.visible = true
        form.reset()
      }
      if (phase === 8) {
        form.titleInput = "Coffee with Alex"
        form.dayInput = "tomorrow"
        form.startInput = "10:00"
        form.endInput = "11:00"
        form.locationInput = "Café Luna"
        form.calendarId = 3
      }
      if (phase === 9) shell.save(card, "quick-add.png")
      if (phase === 10) {
        cardWindow.visible = false
        labelWindow.visible = true
      }
      if (phase === 11) shell.save(labelBox, "bar.png")
      if (phase === 12) Qt.quit()
    }
  }
}

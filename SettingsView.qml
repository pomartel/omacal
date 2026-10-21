import "i18n/Fr.js" as Fr
import "i18n/Backend.js" as Backend
import QtQuick
import Quickshell.Io
import qs.Commons as Commons
import qs.Commons
import qs.Ui
import "Calendar.js" as Cal
import "Places.js" as Places
import "backends/Feeds.js" as Feeds

// Calendar for Omarchy's settings, inside the panel. Omarchy keeps a widget's
// schema but draws no settings screen for it yet, so this is where they are
// set. Every change is written to the widget's entry in shell.json the
// moment it is made, the same place the stock settings live.
//
// Keyboard: Tab and Shift+Tab walk the controls; arrows pick inside a row;
// Enter or Space applies; Escape goes back to the calendar.
FocusScope {
  id: root

  property var panel: null
  property var host: null
  property color foreground: Commons.Color.foreground
  property string fontFamily: Style.font.family

  signal closed()

  function value(key, fallback) {
    return root.panel ? root.panel.setting(key, fallback) : fallback
  }

  function save(key, v) {
    var values = {}
    values[key] = v
    if (root.panel) root.panel.persistSettings(values)
  }

  readonly property var hidden: Cal.parseHiddenCalendars(value("hiddenCalendars", ""))
  property int calendarCursor: 0

  // One calendar shown or hidden, by its key, so a calendar of the same
  // name on another service stays as it is.
  function toggleCalendar(calendar) {
    var calendars = root.host ? root.host.calendars : []
    save("hiddenCalendars", Cal.toggleHidden(root.hidden, calendar, calendars).join(", "))
  }

  // The view takes the keyboard, but no row does until Tab moves into
  // one: a row with keyboard focus marks its cursor chip the way hover
  // does, and a chip lit before anyone asked reads as a stuck selection.
  function focusFirst() {
    Qt.callLater(function() { root.forceActiveFocus() })
  }

  // What each choice does, said plainly under its row. The row describes
  // the chip under the pointer, or the chosen one.
  readonly property var barEventOptions: [
    { value: "soon", label: Fr.t("text.nom_heure"),
      help: Fr.t("text.affiche_le_nom_et_lheure_de_levenement_par_exemple_reunion_dans_1") },
    { value: "name", label: Fr.t("text.nom"),
      help: Fr.t("text.affiche_seulement_le_nom_de_levenement_du_premier_rappel_jusqua_l") },
    { value: "time", label: Fr.t("text.heure"),
      help: Fr.t("text.affiche_seulement_lheure_de_levenement_par_exemple_dans_12_min_du") },
    { value: "next", label: Fr.t("text.suivant"),
      help: Fr.t("text.affiche_le_prochain_evenement_daujourdhui_et_son_heure_par_exempl") },
    { value: "off", label: Fr.t("text.desactive"),
      help: Fr.t("text.affiche_seulement_lhorloge_une_icone_signale_un_evenement_a_venir") }
  ]

  readonly property var leadOptions: [
    { value: "0", label: Fr.t("text.jamais"), help: Fr.t("text.seuls_les_evenements_avec_un_rappel_apparaissent_dans_la_barre_a_") },
    { value: "5", label: Fr.t("text.5_min"), help: Fr.t("text.les_evenements_sans_rappel_apparaissent_5_minutes_avant_le_debut") },
    { value: "15", label: Fr.t("text.15_min"), help: Fr.t("text.les_evenements_sans_rappel_apparaissent_15_minutes_avant_le_debut") },
    { value: "30", label: Fr.t("text.30_min"), help: Fr.t("text.les_evenements_sans_rappel_apparaissent_30_minutes_avant_le_debut") },
    { value: "60", label: Fr.t("text.1_h_f4926b"), help: Fr.t("text.les_evenements_sans_rappel_apparaissent_une_heure_avant_le_debut") }
  ]

  property int barEventHover: -1
  property int leadHover: -1

  function helpFor(options, hovered, current) {
    if (hovered >= 0 && hovered < options.length) return options[hovered].help
    for (var i = 0; i < options.length; i++) if (options[i].value === current) return options[i].help
    return ""
  }

  implicitHeight: settingsColumn.implicitHeight

  // ---- Services
  readonly property var feedContext: ({ dir: Cal.localPath(Qt.resolvedUrl(".")) })
  property var feeds: []
  property string feedError: ""
  property string feedNote: ""

  // What a service's switch says under it: as whom it is read, or what is
  // wrong, or how to set it up.
  function sourceNote(id, setup) {
    if (!root.host || typeof root.host.sourceStatus !== "function") return setup
    var status = root.host.sourceStatus(id)
    if (!status.enabled) return setup
    if (status.ready) return status.account !== "" ? Fr.t("source.reading_account", status.account) : Fr.t("source.reading")
    if (status.error !== "") return status.error
    return Fr.t("source.checking")
  }

  // Off in the screenshot harness, which shows sample feeds.
  property bool loadsFeeds: true

  function loadFeeds() {
    if (!root.loadsFeeds || feedLister.running) return
    feedLister.command = Feeds.listCommand(root.feedContext)
    feedLister.running = true
  }

  function addFeed() {
    if (feedWriter.running) return
    var url = feedUrlField.text.replace(/^\s+|\s+$/g, "")
    if (!Feeds.isFeedAddress(url)) {
      root.feedError = Fr.t("feed.invalid_address")
      return
    }
    root.feedError = ""
    root.feedNote = Fr.t("feed.reading")
    var write = Feeds.addCommand(feedNameField.text, url, root.feedContext)
    feedWriter.run(write.command, write.input)
  }

  function removeFeed(id) {
    if (feedWriter.running) return
    var write = Feeds.removeCommand(id, root.feedContext)
    if (write.command.length === 0) return
    root.feedError = ""
    root.feedNote = ""
    feedWriter.run(write.command, write.input)
  }

  function feedChangeFinished(ok, message) {
    if (ok) {
      feedUrlField.text = ""
      feedNameField.text = ""
      root.feedNote = message
    } else {
      root.feedNote = ""
    }
    root.feedError = ok ? "" : message
    loadFeeds()
    if (root.host && typeof root.host.reloadSource === "function") root.host.reloadSource("feeds")
  }

  onVisibleChanged: if (visible) loadFeeds()

  Process {
    id: feedLister
    running: false
    command: []
    stdout: StdioCollector {
      onStreamFinished: {
        var parsed = Feeds.parseList(text)
        if (parsed !== null) root.feeds = parsed
      }
    }
  }

  // The address goes to the helper on stdin, never as an argument.
  Process {
    id: feedWriter
    running: false
    command: []
    property string input: ""
    property bool answered: false
    property var output: null
    stdinEnabled: true
    function run(argv, text) {
      answered = false
      output = null
      input = text
      command = argv
      stdinEnabled = true
      running = true
    }
    onStarted: {
      if (input !== "") write(input)
      input = ""
      stdinEnabled = false
    }
    stdout: StdioCollector {
      onStreamFinished: feedWriter.output = text
    }
    onExited: function(code) {
      feedAnswer.code = code
      feedAnswer.restart()
    }
  }

  // The output is in by a moment after the helper exits.
  Timer {
    id: feedAnswer
    property int code: 0
    interval: 150
    onTriggered: {
      if (feedWriter.answered) return
      feedWriter.answered = true
      var result = Feeds.writeResult(code, feedWriter.output === null ? "" : feedWriter.output)
      root.feedChangeFinished(result.ok, result.message)
    }
  }

  // The Google key goes to its own file, mode 600, through stdin, so it is
  // never in shell.json or on a command line. An empty key removes it.
  property string keyError: ""

  function saveKey(text) {
    var key = String(text || "").replace(/\s+/g, "")
    if (key !== "" && !Places.isGoogleKey(key)) {
      root.keyError = Fr.t("key.invalid")
      return
    }
    root.keyError = ""
    keyWriter.pendingKey = key
    keyWriter.running = true
  }

  // Reads the key file the same way the form does, to say which service
  // is in use.
  PlaceSearch {
    id: placeKey
    visible: false
  }

  Process {
    id: keyWriter
    property string pendingKey: ""
    command: ["sh", "-c",
      "umask 077; if [ -z \"$2\" ]; then rm -f \"$1\"; exit; fi; "
      + "mkdir -p \"${1%/*}\" && cat > \"$1.new\" && chmod 600 \"$1.new\" && mv -f \"$1.new\" \"$1\"",
      "omacal-places-key", placeKey.keyPath, keyWriter.pendingKey === "" ? "" : "write"]
    stdinEnabled: true
    onStarted: {
      write(pendingKey)
      stdinEnabled = false
    }
    onExited: function(code) {
      stdinEnabled = true
      if (code !== 0) root.keyError = "Could not save the key to " + placeKey.keyPath + "."
      else placeKeyField.text = ""
      pendingKey = ""
    }
  }

  Keys.onEscapePressed: root.closed()

  component Label: Text {
    textFormat: Text.PlainText
    color: Qt.darker(root.foreground, 1.5)
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
    font.letterSpacing: 1
  }

  component Note: Text {
    width: parent ? parent.width : 0
    textFormat: Text.PlainText
    wrapMode: Text.Wrap
    color: Qt.darker(root.foreground, 1.8)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }

  Column {
    id: settingsColumn
    width: parent.width
    spacing: Style.space(8)

    Item {
      width: parent.width
      height: backButton.implicitHeight

      Text {
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        textFormat: Text.PlainText
        text: Fr.t("text.parametres")
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.subtitle
        font.bold: true
        font.letterSpacing: 1
      }

      Button {
        id: backButton
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: Fr.t("text.termine")
        tooltipText: Fr.t("text.retour_au_calendrier_echap")
        bordered: true
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        onClicked: root.closed()
      }
    }

    // ---- Services
    Label { text: Fr.t("text.services_de_calendrier") }

    Toggle {
      width: parent.width
      label: "HEY"
      description: root.sourceNote("hey", Fr.t("source.hey_help"))
      checked: root.value("heyEnabled", false) === true
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.save("heyEnabled", !checked)
    }

    Toggle {
      width: parent.width
      label: Fr.t("text.google_agenda")
      description: root.sourceNote("google", Fr.t("source.google_help"))
      checked: root.value("googleEnabled", true) !== false
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.save("googleEnabled", !checked)
    }

    Label { text: Fr.t("text.compte_google") }
    KeyField {
      width: parent.width
      text: String(root.value("googleAccount", ""))
      placeholderText: Fr.t("text.adresse_du_compte_google")
      onEditingFinished: root.save("googleAccount", text.trim())
    }
    Label { text: Fr.t("text.flux_de_calendrier") }

    Repeater {
      model: root.feeds

      Item {
        required property var modelData
        width: settingsColumn.width
        height: Math.max(feedPill.height, feedRemove.implicitHeight)

        Rectangle {
          id: feedPill
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          width: feedName.implicitWidth + Style.space(20)
          height: feedName.implicitHeight + Style.space(8)
          radius: height / 2
          color: Cal.calendarColor(modelData.color, Commons.Color.accent)

          Text {
            id: feedName
            anchors.centerIn: parent
            textFormat: Text.PlainText
            text: modelData.name
            color: Cal.calendarInk
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
        }

        Text {
          anchors.left: feedPill.right
          anchors.leftMargin: Style.space(8)
          anchors.right: feedRemove.left
          anchors.rightMargin: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          elide: Text.ElideRight
          text: modelData.host
          color: Qt.darker(root.foreground, 1.6)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        Button {
          id: feedRemove
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: Fr.t("text.retirer")
          focusable: true
          enabled: !feedWriter.running
          foreground: root.foreground
          fontFamily: root.fontFamily
          fontSize: Style.font.bodySmall
          onClicked: root.removeFeed(modelData.id)
        }
      }
    }

    Row {
      spacing: Style.space(8)

      KeyField {
        id: feedNameField
        width: Style.space(110)
        placeholderText: Fr.t("text.nom")
        foreground: root.foreground
        font.family: root.fontFamily
        keyHandler: function(event) { if (event.key === Qt.Key_Escape) { root.closed(); event.accepted = true } }
      }

      KeyField {
        id: feedUrlField
        width: Style.space(200)
        password: true
        placeholderText: Fr.t("feed.address")
        foreground: root.foreground
        font.family: root.fontFamily
        onAccepted: if (text !== "") root.addFeed()
        keyHandler: function(event) { if (event.key === Qt.Key_Escape) { root.closed(); event.accepted = true } }
      }

      Button {
        anchors.verticalCenter: parent.verticalCenter
        text: Fr.t("action.add")
        bordered: true
        focusable: true
        enabled: feedUrlField.text !== "" && !feedWriter.running
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        onClicked: root.addFeed()
      }
    }

    Note {
      text: root.feedError !== "" ? Backend.message(root.feedError)
        : (root.feedNote !== "" ? Backend.message(root.feedNote)
          : Fr.t("feed.help"))
      color: root.feedError !== "" ? Commons.Color.urgent : Qt.darker(root.foreground, 1.8)
    }

    // ---- Bar
    Label { text: Fr.t("text.evenement_dans_la_barre") }

    ButtonGroup {
      id: barEventGroup
      // Transparent at rest, not the theme background: the hover fill is a
      // translucent tint, and fading to it from an opaque color flashes bright
      // halfway through before settling.
      background: "transparent"
      options: root.barEventOptions
      value: String(root.value("barEvent", "soon"))
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      onChanged: function(v) { root.save("barEvent", v) }
      onHovered: function(index, isHovered) { root.barEventHover = isHovered ? index : -1 }
    }

    Note {
      text: root.helpFor(root.barEventOptions, root.barEventHover, String(root.value("barEvent", "soon")))
    }

    Label { text: Fr.t("text.preavis_pour_les_evenements_sans_rappel") }

    ButtonGroup {
      // Transparent at rest, not the theme background: the hover fill is a
      // translucent tint, and fading to it from an opaque color flashes bright
      // halfway through before settling.
      background: "transparent"
      options: root.leadOptions
      value: String(Cal.normalizedAlertLead(root.value("alertLeadMinutes", 15)))
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      onChanged: function(v) { root.save("alertLeadMinutes", parseInt(v, 10)) }
      onHovered: function(index, isHovered) { root.leadHover = isHovered ? index : -1 }
    }

    Note {
      text: root.helpFor(root.leadOptions, root.leadHover, String(Cal.normalizedAlertLead(root.value("alertLeadMinutes", 15))))
    }

    Label { text: Fr.t("text.heures") }

    ButtonGroup {
      // Transparent at rest, not the theme background: the hover fill is a
      // translucent tint, and fading to it from an opaque color flashes bright
      // halfway through before settling.
      background: "transparent"
      options: [
        { value: "auto", label: Fr.t("text.selon_le_systeme") },
        { value: "24", label: Fr.t("text.24_h") },
        { value: "12", label: Fr.t("text.12_h") }
      ]
      value: String(root.value("timeFormat", "auto"))
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      onChanged: function(v) { root.save("timeFormat", v) }
    }

    // ---- Switches
    Toggle {
      width: parent.width
      label: Fr.t("text.notifications")
      description: Fr.t("text.afficher_les_rappels_des_evenements_dans_les_notifications_du_bur")
      checked: root.value("notifications", true) !== false
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.save("notifications", !checked)
    }

    Toggle {
      width: parent.width
      visible: !!root.host && root.host.capabilities.watch
      label: Fr.t("text.synchronisation_en_direct")
      description: Fr.t("text.afficher_en_quelques_secondes_les_modifications_faites_ailleurs")
      checked: root.value("liveSync", true) !== false
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.save("liveSync", !checked)
    }

    // ---- Places
    Toggle {
      width: parent.width
      label: Fr.t("text.suggerer_des_lieux")
      description: Fr.t("places.help")
      checked: root.value("placeSuggestions", false) === true
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.save("placeSuggestions", !checked)
    }

    Label { text: Fr.t("key.heading") }

    Row {
      spacing: Style.space(8)

      KeyField {
        id: placeKeyField
        width: Style.space(220)
        password: true
        placeholderText: placeKey.provider === "google" ? Fr.t("key.saved") : Fr.t("key.none")
        foreground: root.foreground
        font.family: root.fontFamily
        onAccepted: if (text !== "") root.saveKey(text)
        keyHandler: function(event) { if (event.key === Qt.Key_Escape) { root.closed(); event.accepted = true } }
      }

      Button {
        anchors.verticalCenter: parent.verticalCenter
        text: Fr.t("action.save")
        bordered: true
        focusable: true
        enabled: placeKeyField.text !== "" && !keyWriter.running
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        onClicked: root.saveKey(placeKeyField.text)
      }

      Button {
        anchors.verticalCenter: parent.verticalCenter
        visible: placeKey.provider === "google"
        text: Fr.t("text.retirer")
        focusable: true
        enabled: !keyWriter.running
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        onClicked: root.saveKey("")
      }
    }

    Note {
      text: root.keyError !== "" ? Backend.message(root.keyError)
        : (placeKey.provider === "google"
          ? Fr.t("places.google")
          : Fr.t("places.osm"))
      color: root.keyError !== "" ? Commons.Color.urgent : Qt.darker(root.foreground, 1.8)
    }

    // ---- Calendars
    Label { text: Fr.t("text.calendriers") }

    Item {
      id: calendarRow
      width: parent.width
      height: calendarFlow.implicitHeight + Style.space(8)
      activeFocusOnTab: true

      Keys.onPressed: function(event) {
        var count = root.host ? root.host.calendars.length : 0
        if (count === 0) return
        if (event.key === Qt.Key_Left || event.key === Qt.Key_H) {
          root.calendarCursor = (root.calendarCursor - 1 + count) % count
        } else if (event.key === Qt.Key_Right || event.key === Qt.Key_L) {
          root.calendarCursor = (root.calendarCursor + 1) % count
        } else if (event.key === Qt.Key_Space || event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
          root.toggleCalendar(root.host.calendars[root.calendarCursor])
        } else {
          return
        }
        event.accepted = true
      }

      FocusRing { visible: calendarRow.activeFocus }

      Flow {
        id: calendarFlow
        anchors.fill: parent
        anchors.margins: Style.space(4)
        spacing: Style.space(6)

        Repeater {
          model: Cal.groupedCalendars(root.host ? root.host.calendars : [])

          Rectangle {
            id: pill
            required property var modelData
            readonly property bool heading: modelData.heading !== undefined
            readonly property bool shown: !Cal.isHidden(modelData, root.hidden)
            readonly property bool cursor: !heading && calendarRow.activeFocus && root.host
              && root.host.calendars.length > root.calendarCursor
              && root.host.calendars[root.calendarCursor].key === modelData.key
            // A service's heading takes a line of its own.
            width: heading ? calendarFlow.width : pillRow.implicitWidth + Style.space(20)
            height: heading ? headingText.implicitHeight + Style.space(2) : pillRow.implicitHeight + Style.space(8)
            radius: heading ? 0 : height / 2
            color: heading || !shown ? "transparent" : Cal.calendarColor(modelData.color, Commons.Color.accent)
            border.width: heading ? 0 : shown ? (cursor ? 2 : 0) : (cursor ? 2 : 1)
            border.color: cursor ? root.foreground : Qt.darker(root.foreground, 1.8)

            Text {
              id: headingText
              visible: pill.heading
              anchors.bottom: parent.bottom
              textFormat: Text.PlainText
              text: pill.heading ? String(pill.modelData.heading).toUpperCase() : ""
              color: Qt.darker(root.foreground, 1.4)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.letterSpacing: 1
            }

            Row {
              id: pillRow
              visible: !pill.heading
              anchors.centerIn: parent
              spacing: Style.space(5)

              Text {
                text: pill.shown ? "󰄬" : "󰅖"
                color: pill.shown ? Cal.calendarInk : Qt.darker(root.foreground, 1.6)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                anchors.verticalCenter: parent.verticalCenter
              }

              Text {
                textFormat: Text.PlainText
                text: pill.modelData.name
                color: pill.shown ? Cal.calendarInk : Qt.darker(root.foreground, 1.6)
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                font.strikeout: !pill.shown
              }
            }

            MouseArea {
              anchors.fill: parent
              enabled: !pill.heading
              cursorShape: Qt.PointingHandCursor
              onClicked: {
                var calendars = root.host ? root.host.calendars : []
                for (var i = 0; i < calendars.length; i++)
                  if (calendars[i].key === pill.modelData.key) root.calendarCursor = i
                root.toggleCalendar(pill.modelData)
              }
            }
          }
        }
      }
    }

    Note {
      text: Fr.t("text.les_calendriers_masques_sont_exclus_de_la_grille_de_la_journee_et")
        + (root.host ? Backend.message(root.host.modeNote()) : "")
    }

    // ---- Quick add
    Label { text: Fr.t("text.raccourci_dajout_rapide") }

    Row {
      spacing: Style.space(8)

      KeyField {
        id: shortcutField
        width: Style.space(220)
        text: String(root.value("quickAddShortcut", "ALT + SHIFT + SPACE"))
        placeholderText: Fr.t("text.desactive")
        foreground: root.foreground
        font.family: root.fontFamily
        onAccepted: root.save("quickAddShortcut", text.replace(/^\s+|\s+$/g, "").toUpperCase())
        keyHandler: function(event) { if (event.key === Qt.Key_Escape) { root.closed(); event.accepted = true } }
      }

      Button {
        anchors.verticalCenter: parent.verticalCenter
        text: Fr.t("text.appliquer")
        bordered: true
        focusable: true
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        onClicked: root.save("quickAddShortcut", shortcutField.text.replace(/^\s+|\s+$/g, "").toUpperCase())
      }
    }

    Note {
      text: Fr.t("text.utilisez_des_modificateurs_et_une_touche_par_exemple_alt_shift_sp")
    }
  }
}

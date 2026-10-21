import QtQuick
import Quickshell
import NativeInput 1.0
import "plugin" as Calendar
ShellRoot {
  Probe { id: probe }
  FloatingWindow {
    visible: true
    Calendar.KeyField { id: field; anchors.fill: parent }
  }
  Timer {
    interval: 100; running: true
    onTriggered: {
      field.forceActiveFocus();
      var ok = probe.compose(field, "^", "ê") && probe.compose(field, "'", "é") && field.text === "êé";
      field.selectAll();
      ok = ok && probe.compose(field, "`", "à") && field.text === "à";
      if (!ok) { console.error("FRENCH INPUT FAILED"); Qt.exit(1); }
      else { console.log("FRENCH INPUT PASSED"); Qt.quit(); }
    }
  }
}

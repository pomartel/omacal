import QtQuick
import qs.Ui as UI

// Native Qt input preserves French dead keys, Compose, IME, selection and undo.
UI.TextField {
  id: root
  property var allowed: null
  property var keyHandler: null
  property var preKey: null
  echoMode: password ? TextInput.Password : TextInput.Normal
  validator: RegularExpressionValidator { regularExpression: root.allowed ? new RegExp("(?:" + root.allowed.source + ")*") : /[\s\S]*/ }
  Keys.priority: Keys.BeforeItem
  Keys.onPressed: function(event) {
    if (root.inputMethodComposing) return;
    if (root.preKey) root.preKey(event);
    if (!event.accepted && root.keyHandler) root.keyHandler(event, root);
  }
}

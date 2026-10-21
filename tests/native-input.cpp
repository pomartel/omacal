#include <QQmlExtensionPlugin>
#include <qqml.h>
#include <QCoreApplication>
#include <QInputMethodEvent>
class Probe : public QObject {
 Q_OBJECT
public:
 Q_INVOKABLE bool compose(QObject *field, const QString &preedit, const QString &text) {
   QInputMethodEvent pre(preedit, {});
   QCoreApplication::sendEvent(field, &pre);
   bool composing = field->property("inputMethodComposing").toBool();
   QInputMethodEvent committed;
   committed.setCommitString(text);
   QCoreApplication::sendEvent(field, &committed);
   return composing && !field->property("inputMethodComposing").toBool();
 }
};
class NativeInputPlugin : public QQmlExtensionPlugin {
 Q_OBJECT
 Q_PLUGIN_METADATA(IID QQmlExtensionInterface_iid)
public:
 void registerTypes(const char *uri) override { qmlRegisterType<Probe>(uri, 1, 0, "Probe"); }
};
#include "native-input.moc"

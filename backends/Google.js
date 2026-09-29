// Google Calendar through the Google Workspace CLI. No credentials are stored here.
// helperPath is resolved by QML, so the fork can be installed in any directory.
function configured(helperPath, account) {
  function command(action, value) {
    var args = ["timeout", "-k", "3", "120", "python3", helperPath, action, String(account || "")]
    if (value !== undefined) args.push(JSON.stringify(value))
    return args
  }
  return {
    info: { id: "google", name: "Google Agenda" },
    cacheCommand: command("cache"),
    probeCommand: command("probe"),
    probe: probe,
    readError: readError,
    modeNote: function() { return "Les calendriers sélectionnés dans l’application Web Google sont affichés. Les modifications sont récupérées à chaque actualisation." },
    fetchCommand: function(weeks) { return command("events", weeks) },
    calendarsCommand: command("calendars"),
    createCommand: function(request) { return command("create", request) },
    deleteCommand: function(event) {
      if (!event || event.recurring || !event.writable || !event.calendarId || !event.seriesId) return []
      return command("delete", { calendarId: event.calendarId, id: event.seriesId })
    },
    writeResult: writeResult,
    dayUrl: function(day) { return dayUrl(day) + "?authuser=" + encodeURIComponent(String(account || "")) }
  }
}

function probe(output) {
  try {
    var value = JSON.parse(String(output || ""))
    if (value.ok === true) return { mode: "google", error: "" }
    if (value.error) return { mode: "", error: String(value.error) }
  } catch (e) {}
  return { mode: "", error: "Impossible de démarrer Google Agenda. Installez python3 et gws, puis exécutez gws auth login." }
}

function readError(output) {
  try {
    var value = JSON.parse(String(output || ""))
    if (value.ok === false && typeof value.error === "string") return value.error.slice(0, 512)
  } catch (e) {}
  return ""
}

function writeResult(exitCode, output) {
  try {
    var value = JSON.parse(String(output || ""))
    if (exitCode === 0 && value.ok === true) return { ok: true, message: "" }
    if (value.error) return { ok: false, message: String(value.error) }
  } catch (e) {}
  return { ok: false, message: "Google Agenda n’a pas confirmé la modification. Actualisez avant de réessayer." }
}

function dayUrl(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))
    ? "https://calendar.google.com/calendar/r/day/" + day.replace(/-/g, "/")
    : "https://calendar.google.com/"
}

if (typeof module !== "undefined") module.exports = { configured: configured, probe: probe, writeResult: writeResult, dayUrl: dayUrl }

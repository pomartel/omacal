// OmaCal's date, event and bar model, shared by the Google Agenda views.
// Qt-free so the same model runs in QML and the Node test suite.
// Google returns expanded recurring occurrences, one JSON line per week:
// { week: "YYYY-MM-DD", events: [...] }, or { week, error: true }.

var MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december"]

var MS_PER_DAY = 86400000

var cliOutputByteLimit = 4 * 1024 * 1024
var maximumEventCount = 2000

function isDayKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function boundedString(value, limit) {
  var text = String(value === undefined || value === null ? "" : value)
  return text.length > limit ? text.substr(0, limit) : text
}

// Only ever handed to a browser launcher, so anything that is not plainly a
// web URL is dropped rather than passed along.
function safeUrl(value) {
  var text = boundedString(value, 2048).replace(/^\s+|\s+$/g, "")
  return /^https:\/\/[^\s"'<>\\]+$/.test(text) ? text : ""
}

function parseInstant(value) {
  var ms = Date.parse(String(value || ""))
  return isFinite(ms) ? ms : null
}

// Titles, locations and calendar names are text somebody else wrote, so every
// string that reaches a binding is length-capped here and rendered as
// PlainText there.
function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null

  var startsAt = boundedString(raw.starts_at, 64)
  if (startsAt === "") return null

  var allDay = raw.all_day === true
  var reminders = []
  var rawReminders = Array.isArray(raw.reminders) ? raw.reminders : []
  for (var i = 0; i < rawReminders.length && reminders.length < 8; i++) {
    var at = parseInstant(rawReminders[i])
    if (at !== null) reminders.push(at)
  }

  var seriesId = boundedString(raw.id, 1024)
  var occurrenceId = boundedString(raw.occurrence_id, 1024)
  return {
    // A repeating series shares one id across every day it lands on, so the
    // start is part of the identity: two Mondays of a standup are two rows.
    key: (typeof raw.calendar_id === "string" ? raw.calendar_id + ":" : "") + (occurrenceId || seriesId) + "@" + startsAt,
    seriesId: seriesId,
    occurrenceId: occurrenceId,
    recurring: raw.recurring === true,
    title: boundedString(raw.title, 256) || "(sans titre)",
    allDay: allDay,
    startsAt: startsAt,
    endsAt: boundedString(raw.ends_at, 64) || startsAt,
    location: boundedString(raw.location, 256),
    calendarId: typeof raw.calendar_id === "string" ? boundedString(raw.calendar_id, 1024) : Number(raw.calendar_id) || 0,
    writable: raw.writable !== false,
    calendar: boundedString(raw.calendar, 128),
    color: boundedString(raw.color, 32).toLowerCase(),
    joinUrl: safeUrl(raw.join_url),
    joinTitle: boundedString(raw.join_title, 64),
    url: safeUrl(raw.url),
    status: boundedString(raw.status, 32),
    reminders: reminders,
    // Resolved once, here, so nothing downstream has to remember that an
    // all-day event is a floating date rather than an instant.
    startMs: allDay ? null : parseInstant(startsAt),
    endMs: allDay ? null : parseInstant(raw.ends_at || startsAt)
  }
}

function normalizeEvents(list) {
  var events = []
  var raw = Array.isArray(list) ? list : []
  for (var i = 0; i < raw.length && events.length < maximumEventCount; i++) {
    var event = normalizeEvent(raw[i])
    if (event) events.push(event)
  }
  return events
}

// One line per week: { week, events } or { week, error: true }. Returns a map
// from week key to its events, with `null` for a week that failed, or null
// when the output as a whole is unusable.
function parseRangeOutput(raw) {
  var text = String(raw === undefined || raw === null ? "" : raw)
  if (text.length > cliOutputByteLimit) return null

  var weeks = {}
  var found = false
  var lines = text.split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^\s+|\s+$/g, "")
    if (line === "") continue
    var parsed
    try {
      parsed = JSON.parse(line)
    } catch (e) {
      continue
    }
    if (!parsed || !isDayKey(parsed.week)) continue
    found = true
    weeks[parsed.week] = parsed.error === true || !Array.isArray(parsed.events)
      ? null
      : normalizeEvents(parsed.events)
  }
  return found ? weeks : null
}

function parseCalendars(raw) {
  var text = String(raw === undefined || raw === null ? "" : raw).replace(/^\s+|\s+$/g, "")
  if (text === "") return null
  var parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return null
  }
  if (!Array.isArray(parsed)) return null

  var calendars = []
  for (var i = 0; i < parsed.length && calendars.length < 100; i++) {
    var c = parsed[i]
    if (!c || !(typeof c.id === "string" ? c.id.length > 0 : Number(c.id) > 0)) continue
    calendars.push({
      id: typeof c.id === "string" ? boundedString(c.id, 1024) : Number(c.id),
      name: boundedString(c.name, 128),
      color: boundedString(c.color, 32).toLowerCase(),
      owned: c.owned === true
    })
  }
  return calendars
}

// Google calendars where the account has write access.
function writableCalendars(calendars) {
  return (Array.isArray(calendars) ? calendars : []).filter(function(calendar) {
    return calendar.owned === true
  })
}

// Merges the per-week lists into one, dropping the copies a multi-day event
// leaves in every week it crosses.
function mergeWeeks(cache) {
  var seen = {}
  var out = []
  var map = cache || {}
  var keys = Object.keys(map).sort()
  for (var i = 0; i < keys.length; i++) {
    var entry = map[keys[i]]
    var events = entry && Array.isArray(entry.events) ? entry.events : []
    for (var j = 0; j < events.length; j++) {
      if (seen[events[j].key]) continue
      seen[events[j].key] = true
      out.push(events[j])
    }
  }
  return out
}

// Calendars named in the `hiddenCalendars` setting are left out, whatever
// the backend. Some backends already leave out what is switched off in
// their own app; for the rest, this is how to hide a calendar.
function parseHiddenCalendars(value) {
  var list = Array.isArray(value) ? value : String(value || "").split(",")
  var out = []
  for (var i = 0; i < list.length; i++) {
    var name = String(list[i] || "").replace(/^\s+|\s+$/g, "").toLowerCase()
    if (name !== "" && out.indexOf(name) === -1) out.push(name)
  }
  return out
}

function withoutHidden(events, hidden) {
  var names = Array.isArray(hidden) ? hidden : []
  if (names.length === 0) return events
  var out = []
  for (var i = 0; i < events.length; i++)
    if (names.indexOf(String(events[i].calendar).toLowerCase()) === -1) out.push(events[i])
  return out
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

function pad2(value) {
  var n = Number(value)
  return (n < 10 ? "0" : "") + n
}

function dateKey(year, month, day) {
  return year + "-" + pad2(Number(month) + 1) + "-" + pad2(day)
}

function keyForDate(date) {
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate())
}

function dateFromKey(key) {
  var parts = String(key || "").split("-")
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
}

function addDays(key, delta) {
  var date = dateFromKey(key)
  date.setDate(date.getDate() + delta)
  return keyForDate(date)
}

function daysBetween(fromKey, toKey) {
  var a = dateFromKey(fromKey)
  var b = dateFromKey(toKey)
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
    - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / MS_PER_DAY)
}

// Weeks run Monday to Sunday, and a Monday is the
// canonical name for a week in the event lines backends print.
function weekStartKey(dayKey) {
  var date = dateFromKey(dayKey)
  var weekday = (date.getDay() + 6) % 7
  return addDays(dayKey, -weekday)
}

// Every week touching the span, first to last inclusive.
function weekKeysBetween(firstKey, lastKey) {
  var keys = []
  if (!isDayKey(firstKey) || !isDayKey(lastKey) || lastKey < firstKey) return keys
  var cursor = weekStartKey(firstKey)
  while (cursor <= lastKey && keys.length < 12) {
    keys.push(cursor)
    cursor = addDays(cursor, 7)
  }
  return keys
}

// The days an event occupies, in local terms.
//
// A timed event is an instant, so its days are whatever days that span
// covers here: an 8pm UTC start is tomorrow in Tokyo and today in New York,
// and both are right. One that ends exactly at midnight does not spill onto
// the next day, which it only touches.
//
// An all-day event is a floating date; treating it as an instant would
// slide it onto yesterday for
// everyone west of Greenwich. So its dates are read off the text, never
// converted. Multi-day ones end exclusively (a three-day trip is the 13th to
// the 16th) while a single-day one repeats its own date.
function eventDayKeys(event) {
  if (!event) return []
  var keys = []
  var cursor
  var endKey

  if (!event.allDay) {
    if (event.startMs === null) return []
    var startKey = keyForDate(new Date(event.startMs))
    var endMs = event.endMs === null || event.endMs < event.startMs ? event.startMs : event.endMs
    var end = new Date(endMs)
    endKey = keyForDate(end)
    if (endMs > event.startMs && end.getHours() === 0 && end.getMinutes() === 0 && endKey > startKey)
      endKey = addDays(endKey, -1)
    cursor = startKey
    // Bounded so a corrupt or absurd end cannot spin here.
    while (cursor <= endKey && keys.length < 90) {
      keys.push(cursor)
      cursor = addDays(cursor, 1)
    }
    return keys
  }

  var first = String(event.startsAt).substr(0, 10)
  endKey = String(event.endsAt).substr(0, 10)
  if (!isDayKey(first)) return []
  if (!isDayKey(endKey) || endKey <= first) return [first]
  cursor = first
  while (cursor < endKey && keys.length < 90) {
    keys.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return keys.length > 0 ? keys : [first]
}

// All-day events first, then by start, then by title, so two events at the
// same minute keep their order between refreshes.
function compareEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  if (!a.allDay) {
    var delta = (a.startMs || 0) - (b.startMs || 0)
    if (delta !== 0) return delta
  }
  return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0)
}

// Day key → that day's events, sorted. Built once per refresh so the month
// grid and the day view read the same answer without walking the list again.
function indexByDay(events) {
  var index = {}
  var list = Array.isArray(events) ? events : []
  for (var i = 0; i < list.length; i++) {
    var keys = eventDayKeys(list[i])
    for (var k = 0; k < keys.length; k++) {
      if (!index[keys[k]]) index[keys[k]] = []
      index[keys[k]].push(list[i])
    }
  }
  for (var key in index) index[key].sort(compareEvents)
  return index
}

function eventsForDay(events, dayKey) {
  return indexByDay(events)[String(dayKey || "")] || []
}

// A multi-day event seen from one of its days: does it begin here, carry on
// from yesterday, or run into tomorrow? The day view says so instead of
// pretending a flight that left last night takes off again this morning.
function spanPosition(event, dayKey) {
  var keys = eventDayKeys(event)
  if (keys.length <= 1) return "single"
  if (keys[0] === dayKey) return "first"
  if (keys[keys.length - 1] === dayKey) return "last"
  return "middle"
}

// The grid's per-day chips: one per calendar color, carrying how many of the
// day's events wear it. Grouped by color rather than by calendar, because a
// chip is only ever read as a color, and two blue calendars as two blue
// chips would look like a rendering bug. Ordered by the day's first event in
// each color, so the chips read in the same order as the day itself.
//
// Past `limit` colors, the last chip becomes "+N" for everything left over.
function dayChips(dayEvents, limit) {
  var max = Math.max(1, Number(limit) || 3)
  var groups = []
  var byColor = {}
  var list = Array.isArray(dayEvents) ? dayEvents : []
  for (var i = 0; i < list.length; i++) {
    var color = list[i].color || ""
    if (!(color in byColor)) {
      byColor[color] = groups.length
      groups.push({ color: color, count: 0, calendars: [] })
    }
    var group = groups[byColor[color]]
    group.count++
    if (group.calendars.indexOf(list[i].calendar) === -1) group.calendars.push(list[i].calendar)
  }
  if (groups.length <= max) return groups

  var kept = groups.slice(0, max - 1)
  var rest = 0
  for (var j = max - 1; j < groups.length; j++) rest += groups[j].count
  kept.push({ color: "", count: rest, calendars: [], overflow: true })
  return kept
}

// ---------------------------------------------------------------------------
// Now
// ---------------------------------------------------------------------------

function hasEnded(event, nowMs) {
  if (!event || event.allDay) return false
  var end = event.endMs === null ? event.startMs : event.endMs
  return end !== null && end <= nowMs
}

function isNow(event, nowMs) {
  if (!event || event.allDay || event.startMs === null) return false
  var end = event.endMs === null ? event.startMs : event.endMs
  return event.startMs <= nowMs && nowMs < end
}

function isDeclined(event) {
  return !!event && String(event.status) === "declined"
}

// The thing you are in, or the thing you are about to be in. An all-day
// event only when nothing timed is left, so a birthday does not sit in the
// tooltip over a standup in ten minutes.
function currentOrNextEvent(events, nowMs) {
  var list = Array.isArray(events) ? events : []
  var upcoming = null
  var allDay = null
  for (var i = 0; i < list.length; i++) {
    var event = list[i]
    if (isDeclined(event)) continue
    if (event.allDay) {
      if (!allDay) allDay = event
      continue
    }
    if (isNow(event, nowMs)) return event
    if (event.startMs !== null && event.startMs > nowMs) {
      if (!upcoming || event.startMs < upcoming.startMs) upcoming = event
    }
  }
  return upcoming || allDay
}

var defaultAlertLeadMinutes = 15

function normalizedAlertLead(value) {
  var minutes = Math.round(Number(value))
  if (!isFinite(minutes) || minutes < 0) return defaultAlertLeadMinutes
  return Math.min(240, minutes)
}

// The event the bar's calendar glyph is warning about, or null. One under
// way still counts: an indicator that goes dark the moment the meeting
// starts tells you the opposite of what you need. All-day events never
// count; a birthday is not something you are late for.
function imminentEvent(events, nowMs, leadMinutes) {
  var lead = normalizedAlertLead(leadMinutes)
  if (lead <= 0) return null
  var horizon = nowMs + lead * 60000
  var list = Array.isArray(events) ? events : []
  var soonest = null
  for (var i = 0; i < list.length; i++) {
    var event = list[i]
    if (event.allDay || event.startMs === null || isDeclined(event)) continue
    if (isNow(event, nowMs)) return event
    if (event.startMs > nowMs && event.startMs <= horizon) {
      if (!soonest || event.startMs < soonest.startMs) soonest = event
    }
  }
  return soonest
}

// What the bar says about an event, after its title: "in 12m" while it is
// coming, "until 14:30" once it has started, "at 16:30" when it is further
// off, nothing for an all-day event.
// Further off it names the day: "tomorrow 09:00", "wed 09:00", "3 oct".
function barWhen(event, nowMs, hour24) {
  if (!event) return ""
  var todayKey = keyForDate(new Date(nowMs))
  if (event.allDay || event.startMs === null) {
    var first = String(event.startsAt).substr(0, 10)
    if (first <= todayKey) return "aujourd’hui"
    return dayWord(first, todayKey)
  }
  if (isNow(event, nowMs)) return event.endMs !== null ? "jusqu’à " + formatTime(new Date(event.endMs), hour24) : "maintenant"
  var minutes = Math.max(0, Math.round((event.startMs - nowMs) / 60000))
  if (minutes === 0) return "maintenant"
  if (minutes < 60) return "dans " + minutes + " min"
  var startKey = keyForDate(new Date(event.startMs))
  var time = formatTime(new Date(event.startMs), hour24)
  if (startKey === todayKey) return "à " + time
  var days = daysBetween(todayKey, startKey)
  return days < 7 ? dayWord(startKey, todayKey) + " " + time : dayWord(startKey, todayKey)
}

var SHORT_WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."]
var SHORT_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]

function dayWord(key, todayKey) {
  var days = daysBetween(todayKey, key)
  if (days === 1) return "demain"
  var date = dateFromKey(key)
  if (days > 1 && days < 7) return SHORT_WEEKDAYS[date.getDay()]
  return date.getDate() + " " + SHORT_MONTHS[date.getMonth()]
}

var barTitleLimit = 28

function barEventLabel(event, nowMs, hour24, titleOnly) {
  if (!event) return ""
  var title = String(event.title || "")
  if (title.length > barTitleLimit) title = title.substr(0, barTitleLimit - 1).replace(/\s+$/, "") + "…"
  if (titleOnly) return title
  var when = barWhen(event, nowMs, hour24)
  return when === "" ? title : title + " · " + when
}

// When the bar starts naming an event: at its earliest reminder, so an
// event you asked to hear about a day ahead is in the bar a day ahead. One
// without reminders uses the lead time; an all-day one without reminders
// is never named, the way a birthday nobody set an alert for stays quiet.
function barWindowStart(event, leadMinutes) {
  var start = event.allDay ? dateFromKey(String(event.startsAt).substr(0, 10)).getTime() : event.startMs
  if (start === null) return null
  var earliest = null
  var reminders = event.reminders || []
  for (var i = 0; i < reminders.length; i++)
    if (reminders[i] <= start && (earliest === null || reminders[i] < earliest)) earliest = reminders[i]
  if (earliest !== null) return earliest
  if (event.allDay) return null
  var lead = normalizedAlertLead(leadMinutes)
  return lead > 0 ? start - lead * 60000 : null
}

// Where an event stops being named: its end, or the end of an all-day
// event's last day.
function barWindowEnd(event) {
  if (!event.allDay) return event.endMs === null ? event.startMs : event.endMs
  var days = eventDayKeys(event)
  return days.length === 0 ? null : dateFromKey(addDays(days[days.length - 1], 1)).getTime()
}

// Every event whose bar window is open now, most deserving first:
//   1. about to start (within the lead time), soonest first: you need to
//      move, whatever else is going on;
//   2. under way, the one ending soonest first;
//   3. coming, inside its reminder window, soonest first;
//   4. all-day ones.
function barEvents(events, nowMs, leadMinutes) {
  var lead = normalizedAlertLead(leadMinutes) * 60000
  var list = Array.isArray(events) ? events : []
  var open = []
  for (var i = 0; i < list.length; i++) {
    var event = list[i]
    if (isDeclined(event)) continue
    var from = barWindowStart(event, leadMinutes)
    var until = barWindowEnd(event)
    if (from === null || until === null || nowMs < from || nowMs >= until) continue
    var rank
    var order
    if (event.allDay) { rank = 4; order = from }
    else if (isNow(event, nowMs)) { rank = 2; order = until }
    else if (event.startMs - nowMs <= lead) { rank = 1; order = event.startMs }
    else { rank = 3; order = event.startMs }
    open.push({ event: event, rank: rank, order: order })
  }
  open.sort(function(a, b) { return a.rank - b.rank || a.order - b.order || compareEvents(a.event, b.event) })
  return open.map(function(o) { return o.event })
}

// Which events the bar names, by the `barEvent` setting: "soon" (the
// default) those inside their alert windows, "name" and "time" the same
// with only their titles or only when, "next" the next one left today all
// day, "off" none.
function barSelection(mode, events, todayEvents, nowMs, leadMinutes) {
  if (mode === "off") return []
  if (mode === "next") {
    var open = barEvents(events, nowMs, leadMinutes)
    if (open.length > 0) return open
    var next = currentOrNextEvent(todayEvents, nowMs)
    return next ? [next] : []
  }
  return barEvents(events, nowMs, leadMinutes)
}

// The first event and how many more: "Podcast · in 12m  +1". The `style`
// is the barEvent mode: "time" says only when ("in 12m  +1"), "name" only
// what ("Podcast  +1"), anything else both.
function barLabel(selection, nowMs, hour24, style) {
  if (!selection || selection.length === 0) return ""
  var label
  if (style === "time") label = barWhen(selection[0], nowMs, hour24) || "today"
  else if (style === "name") label = barEventLabel(selection[0], nowMs, hour24, true)
  else label = barEventLabel(selection[0], nowMs, hour24)
  return selection.length > 1 ? label + "  +" + (selection.length - 1) : label
}

function minutesUntil(event, nowMs) {
  if (!event || event.allDay || event.startMs === null) return 0
  return Math.round((event.startMs - nowMs) / 60000)
}

function normalizedRefreshInterval(value) {
  var seconds = Math.round(Number(value))
  if (!isFinite(seconds) || seconds < 30) return 300
  return Math.min(3600, seconds)
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

// A reminder older than this when first seen is history, not news: the shell
// was off, or asleep, when it came due.
var reminderGraceMs = 10 * 60000

function reminderKey(event, remindMs) {
  return event.key + "#" + remindMs
}

// The reminders that have come due since the last look and not been shown.
// `sinceMs` is the floor: nothing that came due before the plugin started
// is replayed, so restarting the shell does not re-announce the afternoon.
function dueReminders(events, nowMs, sinceMs, shown) {
  var out = []
  var seen = shown || {}
  var floor = Math.max(Number(sinceMs) || 0, nowMs - reminderGraceMs)
  var list = Array.isArray(events) ? events : []
  for (var i = 0; i < list.length; i++) {
    var event = list[i]
    if (isDeclined(event)) continue
    var reminders = event.reminders || []
    for (var r = 0; r < reminders.length; r++) {
      var at = reminders[r]
      if (at > nowMs || at < floor) continue
      if (seen[reminderKey(event, at)]) continue
      out.push({ event: event, remindMs: at, key: reminderKey(event, at) })
    }
  }
  out.sort(function(a, b) { return a.remindMs - b.remindMs })
  return out
}

// "In 30 minutes", "Maintenant", "Demain": what a notification leads with.
function reminderLead(event, nowMs) {
  if (!event) return ""
  if (event.allDay) {
    var days = daysBetween(keyForDate(new Date(nowMs)), String(event.startsAt).substr(0, 10))
    if (days <= 0) return "Aujourd’hui"
    if (days === 1) return "Demain"
    return "Dans " + days + " jours"
  }
  var minutes = Math.round((event.startMs - nowMs) / 60000)
  if (minutes <= 0) return "Maintenant"
  if (minutes < 60) return "Dans " + minutes + " min"
  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60
  if (hours < 24) return "Dans " + hours + " h" + (rest > 0 ? " " + rest + " min" : "")
  var d = Math.round(hours / 24)
  return d === 1 ? "Demain" : "Dans " + d + " jours"
}

function notificationBody(event, nowMs, hour24) {
  var lines = [reminderLead(event, nowMs) + " · " + eventRangeLabel(event, hour24)]
  if (event.calendar !== "") lines.push(event.calendar)
  if (event.location !== "") lines.push(event.location)
  return lines.join("\n")
}

// The notification, and what to open if it is clicked. It waits for the
// answer, which is why this runs detached.
//
// Event titles, calendars, places and links are private, and a process's
// arguments are readable by every user on the machine (/proc/<pid>/cmdline),
// so none of it goes on a command line: it travels in the environment, which
// only this user can read, and the notification is sent over D-Bus from
// Python instead of through notify-send, which only takes it as arguments.
// The system Python, because it has PyGObject on Omarchy and a mise or
// virtualenv one first on PATH may not.
//
// Every monitor's bar runs its own widget, and each would send the same
// reminder. The first to create the reminder's marker directory claims it
// (mkdir either creates or fails, atomically); the rest stay quiet. Markers
// live in the runtime directory and are swept after two days.
//
// The icon is a small calendar page in the event's calendar colour with its
// day on it, written once per colour and day next to the markers.
var notifyScript = [
  "import os, shutil, sys, time",
  "from gi.repository import Gio, GLib",
  "env = {k: os.environ.pop('OMACAL_' + k, '') for k in ('TITLE', 'BODY', 'LINK', 'MARKER', 'ICON', 'SVG')}",
  "base = os.path.join(os.environ.get('XDG_RUNTIME_DIR') or '/tmp', 'omacal')",
  "shown = os.path.join(base, 'shown')",
  "try:",
  "    os.makedirs(shown, exist_ok=True)",
  "    for name in os.listdir(shown):",
  "        path = os.path.join(shown, name)",
  "        if os.path.getmtime(path) < time.time() - 2 * 86400:",
  "            shutil.rmtree(path, ignore_errors=True)",
  "    os.mkdir(os.path.join(shown, env['MARKER']))",
  "except OSError:",
  "    sys.exit(0)",
  "icon = os.path.join(base, env['ICON'])",
  "if not os.path.isfile(icon) or os.path.getsize(icon) == 0:",
  "    with open(icon, 'w') as f:",
  "        f.write(env['SVG'])",
  "loop = GLib.MainLoop()",
  "sent = [None]",
  "def answered(bus, sender, path, iface, signal, params, data):",
  "    if params[0] != sent[0]: return",
  "    if signal == 'ActionInvoked' and params[1] == 'default' and env['LINK']:",
  "        Gio.AppInfo.launch_default_for_uri(env['LINK'], None)",
  "    loop.quit()",
  "try:",
  "    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)",
  "    bus.signal_subscribe('org.freedesktop.Notifications', 'org.freedesktop.Notifications', None,",
  "        '/org/freedesktop/Notifications', None, Gio.DBusSignalFlags.NONE, answered, None)",
  "    sent[0] = bus.call_sync('org.freedesktop.Notifications', '/org/freedesktop/Notifications',",
  "        'org.freedesktop.Notifications', 'Notify',",
  "        GLib.Variant('(susssasa{sv}i)', ('OmaCal', 0, icon, env['TITLE'], env['BODY'], ['default', 'Open'], {}, -1)),",
  "        GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, -1, None).unpack()[0]",
  "except GLib.Error:",
  "    sys.exit(0)",
  "GLib.timeout_add_seconds(86400, loop.quit)",
  "loop.run()"
].join("\n")

// A calendar page: the calendar's colour, a darker band with two rings,
// and the day of the month in the calendar ink.
function notificationIcon(color, day) {
  var fill = calendarColor(color, todayColor)
  var number = String(Math.max(1, Math.min(31, Math.round(Number(day) || 1))))
  return '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
    + '<rect x="10" y="16" width="108" height="104" rx="22" fill="' + fill + '"/>'
    + '<path d="M10 38a22 22 0 0 1 22-22h64a22 22 0 0 1 22 22v8H10z" fill="' + calendarInk + '" fill-opacity="0.22"/>'
    + '<rect x="36" y="6" width="10" height="24" rx="5" fill="' + calendarInk + '"/>'
    + '<rect x="82" y="6" width="10" height="24" rx="5" fill="' + calendarInk + '"/>'
    + '<text x="64" y="102" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700"'
    + ' font-size="52" fill="' + calendarInk + '">' + number + '</text></svg>'
}

// A marker name no event text can escape from: only letters, digits, _ and -.
function reminderMarker(key) {
  return String(key || "").replace(/[^A-Za-z0-9_-]/g, "_").substr(0, 200)
}

// `fallbackLink` is where a click goes when the event has no link of its
// own: the backend's page for its day, if it has one. `remindMs` names the
// reminder, so each of an event's reminders is claimed separately. Returns a
// command with no event text in it, and the environment that carries it.
function notifyCommand(event, nowMs, hour24, fallbackLink, remindMs) {
  var link = event.joinUrl || event.url || safeUrl(fallbackLink)
  var firstDay = eventDayKeys(event)[0] || keyForDate(new Date(nowMs))
  var day = parseInt(firstDay.substr(8, 2), 10)
  var color = calendarColor(event.color, todayColor).replace("#", "")
  return {
    command: ["/usr/bin/python3", "-c", notifyScript],
    environment: {
      OMACAL_TITLE: String(event.title || ""),
      OMACAL_BODY: notificationBody(event, nowMs, hour24),
      OMACAL_LINK: link || "",
      OMACAL_MARKER: reminderMarker(reminderKey(event, remindMs === undefined ? nowMs : remindMs)),
      OMACAL_ICON: "icon-" + color + "-" + day + ".svg",
      OMACAL_SVG: notificationIcon(event.color, day)
    }
  }
}

// ---------------------------------------------------------------------------
// Creating events
// ---------------------------------------------------------------------------

// Loose clock input: "9", "930", "9:30", "21.30", "9pm", "9:30 am".
// Returns "HH:MM", or "" when it is not a time.
function parseClock(value) {
  var text = String(value === undefined || value === null ? "" : value)
    .toLowerCase().replace(/\s+/g, "")
  if (text === "") return ""
  var match = /^(\d{1,2})(?:[:.h]?(\d{2}))?(a|am|p|pm)?$/.exec(text)
  if (!match) return ""
  var hours = parseInt(match[1], 10)
  var minutes = match[2] ? parseInt(match[2], 10) : 0
  var suffix = match[3] || ""
  if (minutes > 59) return ""
  if (suffix !== "") {
    if (hours < 1 || hours > 12) return ""
    if (suffix.charAt(0) === "p" && hours !== 12) hours += 12
    if (suffix.charAt(0) === "a" && hours === 12) hours = 0
  }
  if (hours > 23) return ""
  return pad2(hours) + ":" + pad2(minutes)
}

var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

function matchName(word, names, minimum) {
  if (word.length < minimum) return -1
  for (var i = 0; i < names.length; i++) if (names[i].indexOf(word) === 0) return i
  return -1
}

// Loose day input, relative to today: "today", "tomorrow", "fri" (the next
// Friday, today included), "next fri" (the one after), "in 3 days", "+3",
// "3 oct", "oct 3", "3" (the next 3rd), or "2026-10-03". Returns a day key,
// or "" when it is not a day. Blank means today.
function parseDay(value, todayKey) {
  var text = String(value === undefined || value === null ? "" : value)
    .toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ").replace(/^ | $/g, "")
  // Accept French date input while retaining the original English forms.
  text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "")
  var frenchWords = {
    aujourdhui: "today", demain: "tomorrow", hier: "yesterday",
    dimanche: "sunday", dim: "sunday", lundi: "monday", lun: "monday",
    mardi: "tuesday", mercredi: "wednesday", mer: "wednesday",
    jeudi: "thursday", jeu: "thursday", vendredi: "friday", ven: "friday", samedi: "saturday", sam: "saturday",
    janvier: "january", janv: "january", fevrier: "february", fevr: "february",
    mars: "march", avril: "april", avr: "april", mai: "may", juin: "june",
    juillet: "july", juil: "july", juill: "july", aout: "august", septembre: "september", sept: "september",
    octobre: "october", novembre: "november", decembre: "december", dec: "december",
    dans: "in", jour: "day", jours: "days", j: "d", semaine: "week", semaines: "weeks", sem: "weeks"
  }
  text = text.replace(/[a-z]+/g, function(word) { return frenchWords[word] || word })
  text = text.replace(/^(\w+) prochain$/, "next $1")
  if (!isDayKey(todayKey)) return ""
  if (text === "" || text === "today" || text === "tod") return todayKey
  if (text === "tomorrow" || text === "tmr" || text === "tom") return addDays(todayKey, 1)
  if (text === "yesterday") return addDays(todayKey, -1)
  if (isDayKey(text)) {
    var exact = dateFromKey(text)
    return keyForDate(exact) === text ? text : ""
  }

  var match = /^(?:in )?\+?(\d{1,3}) ?(d|day|days|w|wk|week|weeks)?$/.exec(text)
  if (match && (match[2] || /^(in |\+)/.test(text))) {
    var n = parseInt(match[1], 10)
    return addDays(todayKey, /^w/.test(match[2] || "") ? n * 7 : n)
  }

  match = /^(next )?([a-z]+)$/.exec(text)
  if (match) {
    var weekday = matchName(match[2], WEEKDAYS, 2)
    if (weekday !== -1) {
      var delta = (weekday - dateFromKey(todayKey).getDay() + 7) % 7
      return addDays(todayKey, delta + (match[1] ? 7 : 0))
    }
  }

  var today = dateFromKey(todayKey)
  var day = -1
  var month = -1
  match = /^(\d{1,2})(?:st|nd|rd|th)?(?: ([a-z]+))?(?: (\d{4}))?$/.exec(text)
  if (match) {
    day = parseInt(match[1], 10)
    month = match[2] ? matchName(match[2], MONTH_NAMES, 3) : -2
    if (match[2] && month === -1) return ""
  } else {
    match = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(text)
    if (!match) return ""
    month = matchName(match[1], MONTH_NAMES, 3)
    day = parseInt(match[2], 10)
    if (month === -1) return ""
    match = [match[0], match[2], match[1], match[3]]
  }
  var year = match[3] ? parseInt(match[3], 10) : today.getFullYear()

  // A bare day number is the next one to come: "3" on the 28th is the 3rd
  // of next month. A day and month without a year is the next one too.
  var candidate
  if (month === -2) {
    candidate = new Date(today.getFullYear(), today.getMonth(), day)
    if (candidate.getDate() !== day || keyForDate(candidate) < todayKey)
      candidate = new Date(today.getFullYear(), today.getMonth() + 1, day)
    if (candidate.getDate() !== day) return ""
    return keyForDate(candidate)
  }
  candidate = new Date(year, month, day)
  if (candidate.getDate() !== day) return ""
  if (!match[3] && keyForDate(candidate) < todayKey) candidate = new Date(year + 1, month, day)
  return candidate.getDate() === day ? keyForDate(candidate) : ""
}

function clockMinutes(hhmm) {
  var parts = String(hhmm).split(":")
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
}

function clockFromMinutes(total) {
  var wrapped = ((total % 1440) + 1440) % 1440
  return pad2(Math.floor(wrapped / 60)) + ":" + pad2(wrapped % 60)
}

// Up and Down in a time field: moves it by `delta` minutes, landing on the
// grid of that step ("9:07" up by 15 is 9:15, not 9:22). A blank or
// unreadable field starts from `fallback`.
function nudgeClock(text, delta, fallback) {
  var current = parseClock(text)
  if (current === "") current = parseClock(fallback)
  if (current === "") return ""
  var minutes = clockMinutes(current)
  var step = Math.abs(delta) || 15
  var snapped = delta > 0 ? Math.floor(minutes / step) * step + step : Math.ceil(minutes / step) * step - step
  return clockFromMinutes(snapped)
}

// "09:30" plus 60 is "10:30", unsnapped. "" when the time is unreadable.
function shiftClock(text, minutes) {
  var current = parseClock(text)
  return current === "" ? "" : clockFromMinutes(clockMinutes(current) + minutes)
}

// Steps through a list, wrapping at both ends. Unknown current values
// start from the first entry.
function cycle(list, current, delta) {
  if (!list || list.length === 0) return current
  var index = list.indexOf(current)
  if (index === -1) return list[0]
  return list[((index + delta) % list.length + list.length) % list.length]
}

// The next half hour from now, which is what a fresh event on today starts at.
// Other days start at nine.
function suggestedStart(dayKey, now) {
  if (dayKey !== keyForDate(now)) return "09:00"
  var minutes = now.getHours() * 60 + now.getMinutes()
  var next = Math.ceil((minutes + 1) / 30) * 30
  return next >= 1440 ? "23:30" : clockFromMinutes(next)
}

var reminderChoices = ["", "10m", "30m", "1h", "1d"]

// Checks the new-event form and turns it into the request a backend's
// createCommand takes: { title, date, allDay, startTime, endTime, endDate,
// calendarId, location, remind }, times as HH:MM, the end date worked out.
// Returns { error } or { request }.
function validateEvent(form) {
  var f = form || {}
  var title = String(f.title || "").replace(/^\s+|\s+$/g, "")
  if (title === "") return { error: "Donnez un titre à l’événement." }
  if (title.length > 256) return { error: "Le titre est trop long." }
  if (!isDayKey(f.date)) return { error: "Choisissez une date." }

  var request = { title: title, date: f.date, allDay: f.allDay === true, startTime: "", endTime: "",
    endDate: f.date, calendarId: typeof f.calendarId === "string" ? boundedString(f.calendarId, 1024)
      : (Number(f.calendarId) > 0 ? Math.round(Number(f.calendarId)) : 0),
    location: String(f.location || "").replace(/^\s+|\s+$/g, "").substr(0, 256), remind: "" }

  if (request.allDay) {
    if (f.endDate && f.endDate !== f.date) {
      if (!isDayKey(f.endDate) || f.endDate < f.date) return { error: "La fin doit être après le début." }
      request.endDate = f.endDate
    }
  } else {
    var start = parseClock(f.startTime)
    if (start === "") return { error: "L’heure de début est invalide." }
    request.startTime = start
    var endText = String(f.endTime || "").replace(/\s+/g, "")
    if (endText !== "") {
      var end = parseClock(endText)
      if (end === "") return { error: "L’heure de fin est invalide." }
      if (clockMinutes(end) === clockMinutes(start)) return { error: "La fin doit être après le début." }
      // An end before the start is read as the next morning, the way you
      // mean "22:00 to 01:00".
      if (clockMinutes(end) < clockMinutes(start)) request.endDate = addDays(f.date, 1)
      request.endTime = end
    }
  }

  var remind = String(f.remind || "")
  if (remind !== "" && reminderChoices.indexOf(remind) !== -1) request.remind = remind
  return { request: request }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTime(date, hour24) {
  if (!date) return ""
  var hours = date.getHours()
  var minutes = pad2(date.getMinutes())
  if (hour24) return pad2(hours) + ":" + minutes
  var suffix = hours < 12 ? "am" : "pm"
  var hour12 = hours % 12
  if (hour12 === 0) hour12 = 12
  return hour12 + ":" + minutes + suffix
}

function eventRangeLabel(event, hour24) {
  if (!event) return ""
  if (event.allDay) return "Toute la journée"
  if (event.startMs === null) return ""
  var start = formatTime(new Date(event.startMs), hour24)
  if (event.endMs === null || event.endMs <= event.startMs) return start
  return start + " – " + formatTime(new Date(event.endMs), hour24)
}

// What the day view prints above a title. A multi-day event names the part
// of it this day holds: "from 09:00", "until 10:00", or "toute la journée".
function eventTimeOnDay(event, dayKey, hour24) {
  if (!event) return ""
  if (event.allDay) return ""
  switch (spanPosition(event, dayKey)) {
  case "first": return "à partir de " + formatTime(new Date(event.startMs), hour24)
  case "last": return "jusqu’à " + formatTime(new Date(event.endMs), hour24)
  case "middle": return "toute la journée"
  default: return eventRangeLabel(event, hour24)
  }
}

// "Aujourd’hui", "Demain", "Hier", or how far away it is.
function relativeDayLabel(dayKey, todayKey) {
  var delta = daysBetween(todayKey, dayKey)
  if (delta === 0) return "Aujourd’hui"
  if (delta === 1) return "Demain"
  if (delta === -1) return "Hier"
  if (delta > 1) return "Dans " + delta + " jours"
  return (-delta) + " jours plus tôt"
}

// External calendars come through as the address they were subscribed from.
// The local part carries the whole distinction between one account and
// another, and fits.
function calendarLabel(name) {
  var text = String(name || "").replace(/^\s+|\s+$/g, "")
  var at = text.indexOf("@")
  if (at > 0 && text.indexOf(" ") === -1) text = text.substr(0, at)
  return text.length > 22 ? text.substr(0, 21) + "…" : text
}

// ---------------------------------------------------------------------------
// Calendar colors
// ---------------------------------------------------------------------------

// Dark ink on calendar fills.
var calendarInk = "#1b2632"

// The "today" marker: the warm orange blob behind the day's name.
var todayColor = "#fcb55b"

// Google's hex colors pass through as they are.
// Anything else falls through to the caller's accent, so a calendar the
// plugin has never heard of is never invisible.
function calendarColor(name, fallback) {
  var key = String(name || "").toLowerCase().replace(/^\s+|\s+$/g, "")
  if (/^#[0-9a-f]{6}$/.test(key)) return key
  return fallback
}

if (typeof module !== "undefined") {
  module.exports = {
    isDayKey: isDayKey,
    boundedString: boundedString,
    safeUrl: safeUrl,
    parseInstant: parseInstant,
    normalizeEvent: normalizeEvent,
    normalizeEvents: normalizeEvents,
    parseRangeOutput: parseRangeOutput,
    parseCalendars: parseCalendars,
    writableCalendars: writableCalendars,
    mergeWeeks: mergeWeeks,
    parseHiddenCalendars: parseHiddenCalendars,
    withoutHidden: withoutHidden,
    dateKey: dateKey,
    keyForDate: keyForDate,
    dateFromKey: dateFromKey,
    addDays: addDays,
    daysBetween: daysBetween,
    weekStartKey: weekStartKey,
    weekKeysBetween: weekKeysBetween,
    eventDayKeys: eventDayKeys,
    compareEvents: compareEvents,
    indexByDay: indexByDay,
    eventsForDay: eventsForDay,
    spanPosition: spanPosition,
    dayChips: dayChips,
    hasEnded: hasEnded,
    isNow: isNow,
    isDeclined: isDeclined,
    currentOrNextEvent: currentOrNextEvent,
    normalizedAlertLead: normalizedAlertLead,
    imminentEvent: imminentEvent,
    barWhen: barWhen,
    barEventLabel: barEventLabel,
    barWindowStart: barWindowStart,
    barEvents: barEvents,
    barSelection: barSelection,
    barLabel: barLabel,
    minutesUntil: minutesUntil,
    normalizedRefreshInterval: normalizedRefreshInterval,
    reminderKey: reminderKey,
    dueReminders: dueReminders,
    reminderLead: reminderLead,
    notificationBody: notificationBody,
    notifyCommand: notifyCommand,
    notificationIcon: notificationIcon,
    reminderMarker: reminderMarker,
    parseClock: parseClock,
    parseDay: parseDay,
    nudgeClock: nudgeClock,
    shiftClock: shiftClock,
    cycle: cycle,
    suggestedStart: suggestedStart,
    validateEvent: validateEvent,
    formatTime: formatTime,
    eventRangeLabel: eventRangeLabel,
    eventTimeOnDay: eventTimeOnDay,
    relativeDayLabel: relativeDayLabel,
    calendarLabel: calendarLabel,
    calendarColor: calendarColor,
    calendarInk: calendarInk,
    todayColor: todayColor,
    reminderChoices: reminderChoices
  }
}

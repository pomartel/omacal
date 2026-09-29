// Plain node, no dependencies: `tests/run` runs this in several timezones.
var assert = require("assert")
var Cal = require("../Calendar.js")

var tz = process.env.TZ || "local"
var failures = 0

function test(name, fn) {
  try {
    fn()
  } catch (e) {
    failures++
    console.error("FAIL [" + tz + "] " + name + "\n  " + e.message)
  }
}

// A timed event at local wall-clock times, so expectations hold in any zone.
function timed(id, title, y, m, d, h, min, durationMin, extra) {
  var start = new Date(y, m - 1, d, h, min)
  var end = new Date(start.getTime() + durationMin * 60000)
  var raw = {
    id: id, title: title, all_day: false,
    starts_at: start.toISOString(), ends_at: end.toISOString(),
    calendar: "Work", color: "blue", reminders: []
  }
  for (var k in extra || {}) raw[k] = extra[k]
  return Cal.normalizeEvent(raw)
}

function allDay(id, title, startKey, endKey, extra) {
  var raw = {
    id: id, title: title, all_day: true,
    starts_at: startKey + "T00:00:00Z", ends_at: (endKey || startKey) + "T00:00:00Z",
    calendar: "Relationships", color: "red", reminders: []
  }
  for (var k in extra || {}) raw[k] = extra[k]
  return Cal.normalizeEvent(raw)
}

// ---- Days

test("all-day events stay on their date in every zone", function() {
  var e = allDay(1, "Bday", "2026-09-26")
  assert.deepStrictEqual(Cal.eventDayKeys(e), ["2026-09-26"])
})

test("multi-day all-day events end exclusively", function() {
  var e = allDay(1, "Trip", "2026-10-13", "2026-10-16")
  assert.deepStrictEqual(Cal.eventDayKeys(e), ["2026-10-13", "2026-10-14", "2026-10-15"])
})

test("timed events span every local day they cover", function() {
  var e = timed(1, "Train", 2026, 10, 6, 9, 0, (5 * 24 + 1) * 60)
  var keys = Cal.eventDayKeys(e)
  assert.strictEqual(keys[0], "2026-10-06")
  assert.strictEqual(keys[keys.length - 1], "2026-10-11")
  assert.strictEqual(Cal.spanPosition(e, "2026-10-06"), "first")
  assert.strictEqual(Cal.spanPosition(e, "2026-10-08"), "middle")
  assert.strictEqual(Cal.spanPosition(e, "2026-10-11"), "last")
})

test("a timed event ending at midnight does not spill into the next day", function() {
  var e = timed(1, "Late", 2026, 9, 28, 22, 0, 120)
  assert.deepStrictEqual(Cal.eventDayKeys(e), ["2026-09-28"])
})

test("weekKeysBetween names Monday weeks", function() {
  assert.deepStrictEqual(Cal.weekKeysBetween("2026-08-30", "2026-10-10"),
    ["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"])
})

// ---- Chips

test("chips group a day by color with counts, in the day's order", function() {
  var events = [
    timed(1, "Podcast", 2026, 9, 28, 13, 0, 90),
    timed(2, "Standup", 2026, 9, 28, 9, 0, 15),
    timed(3, "Dinner", 2026, 9, 28, 18, 30, 60, { color: "red", calendar: "Relationships" })
  ]
  var chips = Cal.dayChips(Cal.eventsForDay(events, "2026-09-28"), 3)
  assert.deepStrictEqual(chips.map(function(c) { return c.color + ":" + c.count }), ["blue:2", "red:1"])
})

test("past the limit, the last chip is +N for the rest", function() {
  var colors = ["blue", "red", "gold", "teal", "green"]
  var events = colors.map(function(color, i) {
    return timed(i + 1, "E" + i, 2026, 9, 28, 8 + i, 0, 30, { color: color })
  })
  var chips = Cal.dayChips(Cal.eventsForDay(events, "2026-09-28"), 3)
  assert.strictEqual(chips.length, 3)
  assert.strictEqual(chips[2].overflow, true)
  assert.strictEqual(chips[2].count, 3)
})

// ---- Parsing

test("week output: failures are null, not empty", function() {
  var out = '{"week":"2026-09-28","events":[{"id":1,"title":"A","starts_at":"2026-09-28T10:00:00Z","ends_at":"2026-09-28T11:00:00Z"}]}\n'
    + '{"week":"2026-10-05","error":true}\n'
  var weeks = Cal.parseRangeOutput(out)
  assert.strictEqual(weeks["2026-09-28"].length, 1)
  assert.strictEqual(weeks["2026-10-05"], null)
  assert.strictEqual(Cal.parseRangeOutput(""), null)
})

test("unsafe links are dropped", function() {
  assert.strictEqual(Cal.safeUrl("javascript:alert(1)"), "")
  assert.strictEqual(Cal.safeUrl("https://meet.example.com/x"), "https://meet.example.com/x")
})

test("hidden calendars are matched by name, case-insensitively", function() {
  var events = [timed(1, "A", 2026, 9, 28, 9, 0, 30), timed(2, "B", 2026, 9, 28, 10, 0, 30, { calendar: "Todoist" })]
  var hidden = Cal.parseHiddenCalendars("todoist, ")
  assert.deepStrictEqual(Cal.withoutHidden(events, hidden).map(function(e) { return e.title }), ["A"])
})

// ---- Bar

test("the bar names an event and says when", function() {
  var e = timed(1, "Team sync", 2026, 9, 28, 13, 0, 90)
  var before = e.startMs - 12 * 60000
  assert.strictEqual(Cal.barEventLabel(e, before, true), "Team sync · dans 12 min")
  assert.strictEqual(Cal.barEventLabel(e, e.startMs + 60000, true), "Team sync · jusqu’à 14:30")
  assert.strictEqual(Cal.barEventLabel(e, e.startMs - 3 * 3600000, true), "Team sync · à 13:00")
  assert.strictEqual(Cal.barEventLabel(e, e.startMs - 24 * 3600000, true), "Team sync · demain 13:00")
})

test("the bar opens at the earliest reminder, or the lead time without one", function() {
  var e = timed(1, "Flight", 2026, 9, 28, 13, 0, 90)
  e.reminders = [e.startMs - 30 * 60000, e.startMs - 24 * 3600000]
  assert.deepStrictEqual(Cal.barSelection("soon", [e], [], e.startMs - 20 * 3600000, 15), [e])
  assert.deepStrictEqual(Cal.barSelection("soon", [e], [], e.startMs - 25 * 3600000, 15), [])
  var plain = timed(2, "Call", 2026, 9, 28, 13, 0, 30)
  assert.deepStrictEqual(Cal.barSelection("soon", [plain], [], plain.startMs - 20 * 60000, 15), [])
  assert.deepStrictEqual(Cal.barSelection("soon", [plain], [], plain.startMs - 10 * 60000, 15), [plain])
  assert.deepStrictEqual(Cal.barSelection("soon", [plain], [], plain.endMs, 15), [])
})

test("all-day events show from their reminder, never without one", function() {
  var bday = allDay(3, "Lena's bday", "2026-09-29")
  var eve = new Date(2026, 8, 28, 20, 0).getTime()
  assert.deepStrictEqual(Cal.barSelection("soon", [bday], [], eve, 15), [])
  bday.reminders = [new Date(2026, 8, 28, 8, 0).getTime()]
  assert.deepStrictEqual(Cal.barSelection("soon", [bday], [], eve, 15), [bday])
  assert.strictEqual(Cal.barEventLabel(bday, eve, true), "Lena's bday · demain")
  assert.deepStrictEqual(Cal.barSelection("soon", [bday], [], new Date(2026, 8, 30, 0, 1).getTime(), 15), [])
})

test("overlaps: about to start beats under way beats coming beats all day", function() {
  var now = new Date(2026, 9, 1, 10, 0).getTime()
  var meeting = timed(1, "Meeting", 2026, 10, 1, 9, 30, 60)
  var soon = timed(2, "Standup", 2026, 10, 1, 10, 10, 15)
  var later = timed(3, "Lunch", 2026, 10, 1, 12, 0, 60)
  later.reminders = [later.startMs - 3 * 3600000]
  var holiday = allDay(4, "Holiday", "2026-10-01", "2026-10-01", { reminders: ["2026-09-30T08:00:00Z"] })
  var pick = Cal.barSelection("soon", [holiday, later, meeting, soon], [], now, 15)
  assert.deepStrictEqual(pick.map(function(e) { return e.title }), ["Standup", "Meeting", "Lunch", "Holiday"])
  assert.strictEqual(Cal.barLabel(pick, now, true), "Standup · dans 10 min  +3")
  var afterStandup = Cal.barSelection("soon", [meeting, later], [], now + 5 * 60000, 15)
  assert.strictEqual(afterStandup[0].title, "Meeting")
})

test("time mode drops the title and keeps the when", function() {
  var e = timed(1, "Secret meeting", 2026, 9, 28, 13, 0, 30)
  var now = e.startMs - 12 * 60000
  var pick = Cal.barSelection("time", [e], [e], now, 15)
  assert.strictEqual(Cal.barLabel(pick, now, true, "time"), "dans 12 min")
})

test("name mode keeps the title and drops the when", function() {
  var a = timed(1, "Standup", 2026, 9, 28, 13, 0, 15)
  var b = timed(2, "Lunch", 2026, 9, 28, 13, 5, 60)
  var now = a.startMs - 5 * 60000
  var pick = Cal.barSelection("name", [a, b], [a, b], now, 15)
  assert.strictEqual(Cal.barLabel(pick, now, true, "name"), "Standup  +1")
})

test("next mode falls back to today's next event", function() {
  var e = timed(1, "Dinner", 2026, 9, 28, 18, 30, 60)
  var now = e.startMs - 3 * 3600000
  assert.deepStrictEqual(Cal.barSelection("next", [e], [e], now, 15), [e])
  assert.deepStrictEqual(Cal.barSelection("off", [e], [e], e.startMs - 60000, 15), [])
})

test("long titles are cut to fit the bar", function() {
  var e = timed(1, "A very long meeting title that goes on and on", 2026, 9, 28, 13, 0, 30)
  assert.ok(Cal.barEventLabel(e, e.startMs - 60000, true).indexOf("…") !== -1)
})

// ---- Standard shapes any backend prints

test("calendar colors: Google hex, the accent otherwise, the accent otherwise", function() {
  assert.strictEqual(Cal.calendarColor("blue", "#000000"), "#000000")
  assert.strictEqual(Cal.calendarColor("#1A2B3C", "#000000"), "#1a2b3c")
  assert.strictEqual(Cal.calendarColor("chartreuse", "#000000"), "#000000")
})

// ---- Reminders

test("due reminders fire once, and never for what came due before start", function() {
  var now = Date.UTC(2026, 8, 28, 10, 30)
  var e = Cal.normalizeEvent({ id: 1, title: "Podcast", starts_at: "2026-09-28T11:00:00Z", ends_at: "2026-09-28T12:30:00Z",
    reminders: ["2026-09-28T10:30:00Z", "2026-09-28T09:00:00Z"] })
  var due = Cal.dueReminders([e], now, now - 60000, {})
  assert.strictEqual(due.length, 1)
  var shown = {}
  shown[due[0].key] = now
  assert.strictEqual(Cal.dueReminders([e], now + 15000, now - 60000, shown).length, 0)
  assert.strictEqual(Cal.reminderLead(e, now), "Dans 30 min")
})

test("a reminder carries a safe marker and a calendar-coloured icon", function() {
  var e = Hey.normalizeEvent({ id: 7, title: "Stand-up; rm -rf /", starts_at: "2026-09-29T09:30:00Z",
    ends_at: "2026-09-29T09:45:00Z", color: "blue", reminders: ["2026-09-29T09:15:00Z"] })
  var cmd = Hey.notifyCommand(e, e.startMs - 15 * 60000, true, "", e.reminders[0])
  var marker = cmd[7], iconName = cmd[8], svg = cmd[9]
  assert.ok(/^[A-Za-z0-9_-]+$/.test(marker), marker)
  assert.ok(/^icon-6baffc-\d{1,2}\.svg$/.test(iconName), iconName)
  assert.ok(svg.indexOf('fill="#6baffc"') !== -1)
  assert.strictEqual(cmd[4], "Stand-up; rm -rf /")
})

test("declined events never notify", function() {
  var now = Date.UTC(2026, 8, 28, 10, 30)
  var e = Cal.normalizeEvent({ id: 1, title: "Nope", starts_at: "2026-09-28T11:00:00Z", status: "declined",
    reminders: ["2026-09-28T10:30:00Z"] })
  assert.strictEqual(Cal.dueReminders([e], now, 0, {}).length, 0)
})

// ---- New events

test("clock input is forgiving", function() {
  assert.strictEqual(Cal.parseClock("9"), "09:00")
  assert.strictEqual(Cal.parseClock("930"), "09:30")
  assert.strictEqual(Cal.parseClock("21.30"), "21:30")
  assert.strictEqual(Cal.parseClock("9:30pm"), "21:30")
  assert.strictEqual(Cal.parseClock("12am"), "00:00")
  assert.strictEqual(Cal.parseClock("25:00"), "")
  assert.strictEqual(Cal.parseClock("soon"), "")
})

test("day input is forgiving, relative to today (a Monday)", function() {
  var today = "2026-09-28"
  assert.strictEqual(Cal.parseDay("", today), today)
  assert.strictEqual(Cal.parseDay("tomorrow", today), "2026-09-29")
  assert.strictEqual(Cal.parseDay("fri", today), "2026-10-02")
  assert.strictEqual(Cal.parseDay("mon", today), today)
  assert.strictEqual(Cal.parseDay("next mon", today), "2026-10-05")
  assert.strictEqual(Cal.parseDay("in 3 days", today), "2026-10-01")
  assert.strictEqual(Cal.parseDay("+2w", today), "2026-10-12")
  assert.strictEqual(Cal.parseDay("3 oct", today), "2026-10-03")
  assert.strictEqual(Cal.parseDay("Oct 3rd", today), "2026-10-03")
  assert.strictEqual(Cal.parseDay("3", today), "2026-10-03")
  assert.strictEqual(Cal.parseDay("30", today), "2026-09-30")
  assert.strictEqual(Cal.parseDay("1 jan", today), "2027-01-01")
  assert.strictEqual(Cal.parseDay("2026-12-24", today), "2026-12-24")
  assert.strictEqual(Cal.parseDay("31 feb", today), "")
  assert.strictEqual(Cal.parseDay("someday", today), "")
})

test("arrow keys nudge times on a quarter-hour grid, and wrap lists", function() {
  assert.strictEqual(Cal.nudgeClock("9:07", 15, ""), "09:15")
  assert.strictEqual(Cal.nudgeClock("9:07", -15, ""), "09:00")
  assert.strictEqual(Cal.nudgeClock("09:00", 15, ""), "09:15")
  assert.strictEqual(Cal.nudgeClock("", 15, "14:00"), "14:15")
  assert.strictEqual(Cal.nudgeClock("23:45", 15, ""), "00:00")
  assert.strictEqual(Cal.shiftClock("9:30", 60), "10:30")
  assert.strictEqual(Cal.cycle([1, 2, 3], 3, 1), 1)
  assert.strictEqual(Cal.cycle([1, 2, 3], 1, -1), 3)
  assert.strictEqual(Cal.cycle(["", "10m"], "", 1), "10m")
})

test("an end before the start is the next morning", function() {
  var checked = Cal.validateEvent({ title: "Party", date: "2026-09-28", startTime: "22:00", endTime: "1:00" })
  assert.strictEqual(checked.request.endDate, "2026-09-29")
})

test("the form refuses invalid values", function() {
  assert.ok(Cal.validateEvent({ title: " ", date: "2026-09-28" }).error)
  assert.ok(Cal.validateEvent({ title: "X", date: "2026-09-28", startTime: "nope" }).error)
  assert.ok(Cal.validateEvent({ title: "X", date: "2026-09-28", startTime: "10:00", endTime: "10:00" }).error)
})

if (failures > 0) {
  console.error(failures + " failed [" + tz + "]")
  process.exit(1)
}
console.log("ok [" + tz + "]")

// French date input and labels, including Qt's abbreviated month names.
for (const [input, expected] of [
  ["aujourd’hui", "2026-09-28"], ["aujourd'hui", "2026-09-28"],
  ["demain", "2026-09-29"], ["hier", "2026-09-27"],
  ["vendredi", "2026-10-02"], ["ven.", "2026-10-02"],
  ["lundi prochain", "2026-10-05"], ["dans 3 jours", "2026-10-01"],
  ["dans 2 semaines", "2026-10-12"], ["3 février 2027", "2027-02-03"],
  ["3 févr. 2027", "2027-02-03"], ["3 août 2027", "2027-08-03"],
  ["3 mars 2027", "2027-03-03"], ["29 sept. 2026", "2026-09-29"]
]) assert.equal(Cal.parseDay(input, "2026-09-28"), expected, input)
assert.equal(Cal.relativeDayLabel("2026-09-28", "2026-09-28"), "Aujourd’hui")
assert.equal(Cal.relativeDayLabel("2026-09-29", "2026-09-28"), "Demain")

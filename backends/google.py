#!/usr/bin/env python3
"""Translate Google Workspace CLI responses to OmaCal's backend protocol.

No credentials or calendar data are stored. Writes only run on explicit UI actions.
"""
import concurrent.futures
import datetime as dt
import json
import subprocess
import sys
import tempfile
from zoneinfo import ZoneInfo

OUTPUT_LIMIT = 4 * 1024 * 1024
EVENT_LIMIT = 2000


class BackendError(Exception):
    pass


def cli(args, empty_ok=False):
    # Keep subprocess output off the pipe and bound both runtime and what is read.
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run(["gws", *args], stdout=output, stderr=subprocess.DEVNULL,
                                    timeout=20, check=False)
        except FileNotFoundError:
            raise BackendError("Installez gws, puis exécutez gws auth login.") from None
        except subprocess.TimeoutExpired:
            raise BackendError("Google Agenda a mis trop de temps à répondre. Actualisez avant de réessayer une modification.") from None
        output.seek(0)
        raw = output.read(OUTPUT_LIMIT + 1)
    if len(raw) > OUTPUT_LIMIT:
        raise BackendError("Google Agenda a renvoyé trop de données.")
    if result.returncode != 0:
        raise BackendError("La requête Google Agenda a échoué. Vérifiez la connexion à gws et à Internet. Actualisez avant de réessayer une modification.")
    if empty_ok and not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise BackendError("gws a renvoyé des données JSON invalides.") from None
    if not isinstance(value, dict) or value.get("error"):
        raise BackendError("Google Agenda a refusé la requête.")
    return value


def api(resource, method, params, body=None):
    args = ["calendar", resource, method, "--params", json.dumps(params)]
    if body is not None:
        args += ["--json", json.dumps(body)]
    return cli(args, empty_ok=method == "delete")


def verify_account(expected):
    if not expected:
        raise BackendError("Indiquez votre adresse Google dans le champ googleAccount de la configuration OmaCal.")
    status = cli(["auth", "status"])
    if str(status.get("user", "")).lower() != expected.lower():
        raise BackendError("Le compte gws ne correspond pas à googleAccount. Vérifiez avec gws auth status.")
    if not status.get("has_refresh_token") and not status.get("token_valid"):
        raise BackendError("Exécutez gws auth login avec l’accès à Agenda.")


def pages(resource, params, limit):
    items = []
    seen = set()
    for _ in range(100):
        page = api(resource, "list", params)
        if not isinstance(page.get("items", []), list):
            raise BackendError("Google Agenda a renvoyé une liste invalide.")
        items.extend(page.get("items", []))
        if len(items) > limit:
            raise BackendError("Trop d’entrées de calendrier. Aucun calendrier partiel n’a été chargé.")
        token = page.get("nextPageToken")
        if not token:
            return items
        if token in seen:
            break
        seen.add(token)
        params = {**params, "pageToken": token}
    raise BackendError("La récupération des pages Google Agenda n’a pas abouti.")


def calendars():
    return [c for c in pages("calendarList", {"maxResults": 250}, 100)
            if c.get("selected", False) and not c.get("deleted")
            and c.get("accessRole") in ("reader", "writer", "owner")]


def writable(calendar):
    return calendar.get("accessRole") in ("owner", "writer")


def project_calendar(calendar):
    return {"id": calendar["id"], "name": calendar.get("summaryOverride") or calendar.get("summary", ""),
            "color": calendar.get("backgroundColor", ""), "owned": writable(calendar), "kind": ""}


def instant(value, zone):
    if value.get("date"):
        return dt.datetime.combine(dt.date.fromisoformat(value["date"]), dt.time(), ZoneInfo(zone))
    parsed = dt.datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=ZoneInfo(value.get("timeZone", zone)))


def project_event(event, calendar):
    if event.get("status") == "cancelled":
        return None
    start, end = event.get("start", {}), event.get("end", {})
    if not event.get("id") or not (start.get("date") or start.get("dateTime")):
        raise BackendError("Google Agenda a renvoyé un événement sans identifiant ou sans date de début.")
    zone = calendar.get("timeZone", "UTC")
    start_instant = instant(start, zone).astimezone(dt.timezone.utc)
    reminders = event.get("reminders", {})
    rules = calendar.get("defaultReminders", []) if reminders.get("useDefault") else reminders.get("overrides", [])
    reminder_times = [(start_instant - dt.timedelta(minutes=r["minutes"])).isoformat()
                      for r in rules if r.get("method") == "popup" and isinstance(r.get("minutes"), int)]
    meeting = event.get("hangoutLink", "") or next((p.get("uri", "") for p in
        event.get("conferenceData", {}).get("entryPoints", []) if p.get("entryPointType") == "video"), "")
    return {"id": event["id"], "occurrence_id": event["id"],
            "recurring": bool(event.get("recurringEventId") or event.get("recurrence")),
            "title": event.get("summary", "(sans titre)"), "all_day": bool(start.get("date")),
            "starts_at": start.get("date") or instant(start, zone).isoformat(),
            "ends_at": end.get("date") or instant(end, zone).isoformat(),
            "calendar_id": calendar["id"], "calendar": project_calendar(calendar)["name"],
            "color": calendar.get("backgroundColor", ""), "writable": writable(calendar),
            "location": event.get("location", ""), "url": event.get("htmlLink", ""),
            "join_url": meeting, "join_title": "Rejoindre la réunion" if meeting else "",
            "status": next((a.get("responseStatus", "") for a in event.get("attendees", []) if a.get("self")), ""),
            "reminders": reminder_times}


def fetch_week(week, selected):
    first = dt.date.fromisoformat(week)
    # Date-specific local offsets keep week boundaries correct across DST.
    lower = dt.datetime.combine(first, dt.time()).astimezone()
    upper = dt.datetime.combine(first + dt.timedelta(days=7), dt.time()).astimezone()
    events = []
    for calendar in selected:
        raw = pages("events", {"calendarId": calendar["id"], "timeMin": lower.isoformat(),
            "timeMax": upper.isoformat(), "singleEvents": True, "showDeleted": False,
            "maxResults": 250}, EVENT_LIMIT)
        events.extend(value for event in raw if (value := project_event(event, calendar)) is not None)
        if len(events) > EVENT_LIMIT:
            raise BackendError("Trop d’événements dans une semaine. Aucun calendrier partiel n’a été chargé.")
    return {"week": week, "events": events}


def fetch(weeks):
    if not isinstance(weeks, list) or not 1 <= len(weeks) <= 16:
        raise BackendError("Plage de semaines invalide.")
    keys = sorted(set(weeks))
    for key in keys:
        if dt.date.fromisoformat(key).isoformat() != key:
            raise BackendError("Date de semaine invalide.")
    selected = calendars()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        return list(executor.map(lambda key: fetch_week(key, selected), keys))


def write_calendar(calendar_id):
    if not isinstance(calendar_id, str) or not calendar_id:
        raise BackendError("Choisissez un calendrier Google modifiable.")
    calendar = api("calendarList", "get", {"calendarId": calendar_id})
    if not writable(calendar):
        raise BackendError("Ce calendrier Google est en lecture seule.")
    return calendar


def create_body(request):
    title = str(request.get("title", "")).strip()
    if not title or len(title) > 256:
        raise BackendError("Donnez à l’événement un titre de 1 à 256 caractères.")
    first = dt.date.fromisoformat(request["date"])
    last = dt.date.fromisoformat(request.get("endDate", request["date"]))
    if request.get("allDay"):
        end = last if last > first else first + dt.timedelta(days=1)
        start_value, end_value = {"date": first.isoformat()}, {"date": end.isoformat()}
    else:
        start_naive = dt.datetime.combine(first, dt.time.fromisoformat(request["startTime"]))
        start = start_naive.astimezone()
        end_naive = (dt.datetime.combine(last, dt.time.fromisoformat(request["endTime"]))
                     if request.get("endTime") else start_naive + dt.timedelta(hours=1))
        end = end_naive.astimezone()
        if start.replace(tzinfo=None) != start_naive or end.replace(tzinfo=None) != end_naive:
            raise BackendError("Cette heure n’existe pas à cause du changement d’heure. Choisissez une autre heure.")
        if end <= start:
            raise BackendError("La fin de l’événement doit être après le début.")
        start_value, end_value = {"dateTime": start.isoformat()}, {"dateTime": end.isoformat()}
    lead = {"10m": 10, "30m": 30, "1h": 60, "1d": 1440}.get(request.get("remind"))
    return {"summary": title, "location": str(request.get("location", ""))[:256],
            "start": start_value, "end": end_value, "reminders": {"useDefault": False,
            "overrides": [] if lead is None else [{"method": "popup", "minutes": lead}]}}


def create(request):
    write_calendar(request.get("calendarId"))
    result = api("events", "insert", {"calendarId": request["calendarId"], "sendUpdates": "none"}, create_body(request))
    if not result.get("id"):
        raise BackendError("Google n’a pas confirmé la création. Actualisez avant de réessayer.")
    return {"ok": True}


def delete(request):
    write_calendar(request.get("calendarId"))
    params = {"calendarId": request["calendarId"], "eventId": request["id"]}
    # Recheck against the server, not only the potentially stale UI row.
    event = api("events", "get", params)
    if event.get("recurrence") or event.get("recurringEventId"):
        raise BackendError("Supprimez les événements récurrents dans Google Agenda.")
    if event.get("attendees"):
        raise BackendError("Supprimez les événements avec des invités dans Google Agenda pour gérer leurs notifications.")
    api("events", "delete", {**params, "sendUpdates": "none"})
    return {"ok": True}


def main(argv):
    try:
        action, account = argv[1:3]
        verify_account(account)
        value = json.loads(argv[3]) if len(argv) > 3 else None
        if action == "probe":
            results = [{"ok": True}]
        elif action == "calendars":
            results = [[project_calendar(c) for c in calendars()]]
        elif action == "events":
            results = fetch(value)
        elif action == "create":
            results = [create(value)]
        elif action == "delete":
            results = [delete(value)]
        else:
            raise BackendError("Opération Google Agenda inconnue.")
        output = "\n".join(json.dumps(item, separators=(",", ":")) for item in results)
        if len(output.encode()) > OUTPUT_LIMIT:
            raise BackendError("Google Agenda a renvoyé trop de données.")
        print(output)
        return 0
    except (BackendError, ValueError, KeyError, TypeError) as error:
        # Do not print API output, tokens, event text, or tracebacks.
        message = str(error) if isinstance(error, BackendError) else "Données ou requête Google Agenda invalides."
        print(json.dumps({"ok": False, "error": message}))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))

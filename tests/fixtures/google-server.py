#!/usr/bin/env python3
"""Local-only Google Calendar and OAuth fixture for QML integration tests."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

work = Path(os.environ["OMACAL_FIXTURE_DIR"])
calendar = {"id": "calendar@example.test", "summary": "Test calendar", "accessRole": "owner",
            "selected": True, "primary": True, "timeZone": "America/Chicago", "backgroundColor": "#abcdef"}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def answer(self, status, value=None):
        data = json.dumps(value).encode() if value is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_request(self):
        url = urlsplit(self.path)
        path = unquote(url.path)
        size = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(size)
        if path == "/token" and self.command == "POST":
            if parse_qs(body.decode()).get("refresh_token") != ["synthetic-refresh"]:
                return self.answer(400, {})
            return self.answer(200, {"access_token": "synthetic-access"})
        if self.headers.get("Authorization") != "Bearer synthetic-access":
            return self.answer(401, {})
        if path == "/users/me/calendarList":
            return self.answer(200, {"items": [calendar]})
        prefix = "/calendars/calendar@example.test/events"
        if path == "/users/me/calendarList/calendar@example.test":
            return self.answer(200, calendar)
        if path == prefix and self.command == "GET":
            day = parse_qs(url.query)["timeMin"][0][:10]
            return self.answer(200, {"items": [{"id": "fixture-event", "summary": "Fixture meeting",
                "start": {"dateTime": day + "T09:00:00-05:00"}, "end": {"dateTime": day + "T10:00:00-05:00"}}]})
        if path == prefix and self.command == "POST":
            event = json.loads(body)
            if event.get("summary") != "Fixture write":
                return self.answer(400, {})
            return self.answer(200, {"id": "new-event"})
        if path == prefix + "/fixture-event" and self.command == "GET":
            return self.answer(200, {"id": "fixture-event", "organizer": {"self": True}})
        if path == prefix + "/fixture-event" and self.command == "DELETE":
            with (work / "delete-calls").open("a") as count:
                count.write("delete\n")
            import time
            time.sleep(0.3)
            return self.answer(500 if (work / "delete-fail").exists() else 204)
        self.answer(404, {})

    do_GET = do_POST = do_DELETE = handle_request

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
(work / "port").write_text(str(server.server_port))
server.serve_forever()

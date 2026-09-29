"""Bounded, account/timezone-specific calendar snapshots; never credentials."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time

MAX_BYTES = 4 * 1024 * 1024
MAX_WEEKS = 32
MAX_AGE = 30 * 86400


def timezone_key():
    if os.environ.get("TZ"):
        return os.environ["TZ"]
    try:
        return hashlib.sha256(Path("/etc/localtime").read_bytes()).hexdigest()
    except OSError:
        return str(time.tzname)


class CalendarCache:
    def __init__(self, account):
        key = hashlib.sha256((account.strip().lower() + "\0" + timezone_key()).encode()).hexdigest()
        base = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
        self.folder = base / "omacal"
        self.path = self.folder / (key + ".json")
        self.lock_path = self.folder / (key + ".lock")

    @staticmethod
    def empty():
        return {"version": 1, "generation": 0, "weeks": {}, "calendars": []}

    def read(self):
        try:
            with self.path.open("rb") as stream:
                raw = stream.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                return self.empty()
            data = json.loads(raw)
            if (not isinstance(data, dict) or data.get("version") != 1
                    or not isinstance(data.get("generation"), int)
                    or not isinstance(data.get("weeks"), dict)
                    or not isinstance(data.get("calendars"), list)):
                return self.empty()
            now = time.time()
            data["weeks"] = {key: value for key, value in data["weeks"].items()
                if isinstance(value, dict) and isinstance(value.get("events"), list)
                and isinstance(value.get("at"), (int, float))
                and 0 <= now - value["at"] <= MAX_AGE}
            if not 0 <= now - data.get("calendars_at", 0) <= MAX_AGE:
                data["calendars"] = []
            return data
        except (OSError, ValueError, TypeError):
            return self.empty()

    @contextlib.contextmanager
    def locked(self):
        self.folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.folder.chmod(0o700)
        with os.fdopen(os.open(self.lock_path, os.O_CREAT | os.O_RDWR, 0o600), "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def write(self, data):
        # Keep the most recently refreshed weeks, bounded by count and bytes.
        ordered = sorted(data["weeks"], key=lambda k: data["weeks"][k]["at"], reverse=True)
        data["weeks"] = {k: data["weeks"][k] for k in ordered[:MAX_WEEKS]}
        raw = json.dumps(data, separators=(",", ":")).encode()
        while len(raw) > MAX_BYTES and data["weeks"]:
            data["weeks"].pop(next(reversed(data["weeks"])))
            raw = json.dumps(data, separators=(",", ":")).encode()
        if len(raw) > MAX_BYTES:
            return
        name = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.folder, delete=False) as stream:
                name = stream.name
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if name and os.path.exists(name):
                os.unlink(name)

    def save_weeks(self, weeks, generation):
        try:
            with self.locked():
                data = self.read()
                if data["generation"] != generation:
                    return  # A write or calendar-selection change superseded this fetch.
                for week in weeks:
                    data["weeks"][week["week"]] = {"events": week["events"], "at": time.time()}
                self.write(data)
        except OSError:
            pass  # Cache failures must not turn successful Google operations into errors.

    def save_calendars(self, calendars):
        try:
            with self.locked():
                data = self.read()
                if data["calendars"] and data["calendars"] != calendars:
                    data["weeks"] = {}
                    data["generation"] += 1
                data["calendars"] = calendars
                data["calendars_at"] = time.time()
                self.write(data)
        except OSError:
            pass

    def invalidate(self):
        try:
            with self.locked():
                data = self.read()
                data["generation"] += 1
                data["weeks"] = {}
                self.write(data)
        except OSError:
            pass

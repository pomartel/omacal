import concurrent.futures
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "backends"))
from cache import CalendarCache, MAX_AGE, MAX_BYTES, MAX_WEEKS


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        env = patch.dict(os.environ, {"XDG_CACHE_HOME": self.folder.name, "TZ": "America/Montreal"})
        env.start()
        self.addCleanup(env.stop)
        self.cache = CalendarCache("calendar@example.test")

    def week(self, key="2026-09-28"):
        return {"week": key, "events": [{"title": "Événement privé"}]}

    def test_restart_roundtrip_permissions_and_account_isolation(self):
        self.cache.save_weeks([self.week()], 0)
        restored = CalendarCache("CALENDAR@example.test").read()
        self.assertEqual(restored["weeks"]["2026-09-28"]["events"], self.week()["events"])
        self.assertEqual(self.cache.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.cache.folder.stat().st_mode & 0o777, 0o700)
        self.assertFalse(CalendarCache("other@example.test").read()["weeks"])
        with patch.dict(os.environ, {"TZ": "Asia/Tokyo"}):
            self.assertFalse(CalendarCache("calendar@example.test").read()["weeks"])

    def test_corrupt_expired_and_oversized_cache_is_ignored(self):
        with patch("cache.time.time", return_value=time.time() - MAX_AGE - 10):
            self.cache.save_weeks([self.week()], 0)
        self.assertFalse(self.cache.read()["weeks"])
        for raw in [b"broken", b"[]", b'{"version":99}', b'x' * (MAX_BYTES + 1)]:
            self.cache.path.write_bytes(raw)
            self.assertFalse(self.cache.read()["weeks"])

    def test_bounded_and_concurrent_merges(self):
        def save(number):
            self.cache.save_weeks([self.week(str(number))], 0)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(save, range(12)))
        self.assertEqual(len(self.cache.read()["weeks"]), 12)
        for i in range(MAX_WEEKS + 10):
            save(i)
        self.assertEqual(len(self.cache.read()["weeks"]), MAX_WEEKS)
        self.assertLessEqual(self.cache.path.stat().st_size, MAX_BYTES)

    def test_mutation_invalidates_inflight_fetch_and_calendar_changes(self):
        self.cache.save_calendars([{"id": "one"}])
        self.cache.save_weeks([self.week()], 0)
        generation = self.cache.read()["generation"]
        self.cache.invalidate()
        self.cache.save_weeks([self.week()], generation)
        self.assertFalse(self.cache.read()["weeks"])
        self.cache.save_weeks([self.week()], self.cache.read()["generation"])
        self.cache.save_calendars([{"id": "two"}])
        self.assertFalse(self.cache.read()["weeks"])
        self.assertEqual(self.cache.read()["calendars"], [{"id": "two"}])

    def test_unwritable_cache_does_not_fail_google_operations(self):
        with patch.object(self.cache, "write", side_effect=OSError("Disk full")):
            self.cache.save_weeks([self.week()], 0)
            self.cache.save_calendars([])
            self.cache.invalidate()
        self.assertFalse(self.cache.read()["weeks"])

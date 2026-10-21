"""Fork policy: configured Google account and persistent offline snapshots.

Google's transport, event projection and writes stay in the upstream helper.
This module never reads credentials or makes network requests.
"""
import importlib.util
import json
from pathlib import Path


def cache_class():
    # The helper runs with Python -I: resolve our sibling, not sys.path.
    spec = importlib.util.spec_from_file_location("omacal_cache", Path(__file__).with_name("cache.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.CalendarCache


with Path(__file__).resolve().parent.parent.joinpath("i18n", "fr.json").open(encoding="utf-8") as catalog_file:
    MESSAGES = json.load(catalog_file)


class Profile:
    def __init__(self, argv):
        self.argv = list(argv)
        self.account = ""
        if "--account" in self.argv:
            at = self.argv.index("--account")
            self.account = self.argv[at + 1] if len(self.argv) > at + 1 else ""
            del self.argv[at:at + 2]
        self.Cache = cache_class()
        self.cache = self.Cache(self.account) if self.account else None
        self.generation = 0

    def snapshot(self):
        return self.cache.read() if self.cache else self.Cache.empty()

    def verify(self, google, calendars, failure):
        if self.account:
            primary = next((c["id"] for c in calendars(google) if c.get("primary")), "")
            if primary.lower() != self.account.lower():
                raise failure(MESSAGES["google.account_mismatch"])

    def begin_weeks(self):
        self.generation = self.snapshot()["generation"]

    def save_weeks(self, weeks):
        if self.cache:
            self.cache.save_weeks(weeks, self.generation)
        return weeks

    def save_calendars(self, calendars):
        if self.cache:
            self.cache.save_calendars(calendars)
        return calendars

    def wrote(self, message):
        if self.cache:
            self.cache.invalidate()
        return message

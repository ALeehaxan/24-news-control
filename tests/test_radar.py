from datetime import datetime, timezone
import unittest

from scripts.radar import feeds, match_region, merge, parse_feed


class RadarTest(unittest.TestCase):
    now = datetime(2026, 11, 26, tzinfo=timezone.utc)

    def test_collects_both_languages_and_filters_unrelated_or_unsafe_items(self):
        rss = """<rss><channel>
          <item><title>ހދ. ކުޅުދުއްފުށި ޚަބަރު</title><link>https://example.org/dv</link>
            <pubDate>Wed, 25 Nov 2026 15:00:00 GMT</pubDate></item>
          <item><title>Harbour opens in Funadhoo - Example</title><link>https://example.org/en</link>
            <description><![CDATA[<p>Ferry crews can now use the new dock.</p><script>ignored()</script>]]></description>
            <source>Example</source><pubDate>Wed, 25 Nov 2026 15:00:00 GMT</pubDate></item>
          <item><title>Malé update</title><link>https://example.org/other</link>
            <pubDate>Wed, 25 Nov 2026 15:00:00 GMT</pubDate></item>
          <item><title>Funadhoo update</title><link>javascript:alert(1)</link>
            <pubDate>Wed, 25 Nov 2026 15:00:00 GMT</pubDate></item>
        </channel></rss>"""
        items = list(parse_feed(rss.encode(), "Publisher", None, self.now))
        self.assertEqual([(item["language"], item["region"]) for item in items],
                         [("dv", "Haa Dhaalu"), ("en", "Shaviyani")])
        self.assertEqual(items[1]["title"], "Harbour opens in Funadhoo")
        self.assertIn("Example reported", items[1]["draft"])
        self.assertIn("Source excerpt: “Ferry crews can now use the new dock.”", items[1]["draft"])
        self.assertNotIn("ignored()", items[1]["draft"])
        self.assertIn("ޚަބަރު އެރުވިއެވެ", items[0]["draft"])
        legacy = {key: value for key, value in items[0].items() if key != "draft"}
        self.assertEqual(merge([legacy], self.now)[0]["draft"], items[0]["draft"])
        self.assertEqual(merge([*items, dict(items[0], url="https://example.org/duplicate")], self.now), items)

    def test_region_boundaries_and_queries(self):
        self.assertIsNone(match_region("Notfunadhoo"))
        self.assertEqual(match_region("Noonu Atoll flooding"), "Noonu")
        self.assertEqual(match_region("ކަނޑުހުޅުދޫން ޚަބަރު"), "Noonu")
        self.assertEqual(len(list(feeds())), 12)

    def test_search_requires_a_location_in_the_headline(self):
        rss = """<rss><channel>
          <item><title>ދުވާފަރު ޚަބަރު</title><link>https://example.org/news</link>
            <pubDate>Wed, 25 Nov 2026 15:00:00 GMT</pubDate></item>
          <item><title>Dhuvaafaru old</title><link>https://example.org/old</link>
            <pubDate>Sun, 1 Nov 2025 15:00:00 GMT</pubDate></item>
          <item><title>Dhuvaafaru undated</title><link>https://example.org/undated</link></item>
          <item><title>Addu Meedhoo update</title><link>https://example.org/unrelated</link>
            <pubDate>Wed, 25 Nov 2026 15:00:00 GMT</pubDate></item>
        </channel></rss>"""
        self.assertEqual([i["region"] for i in parse_feed(rss.encode(), "Example", "Raa", self.now)], ["Raa"])

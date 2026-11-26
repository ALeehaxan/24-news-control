"""Find public news leads and prepare source-attributed drafts. Runs with the Python standard library."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen
import xml.etree.ElementTree as ET

REGIONS = {
    "Haa Alif": (
        "Haa Alif", "Haa Alifu", "HA Atoll", "North Thiladhunmathi", "Dhidhdhoo", "Utheemu", "Hoarafushi", "Ihavandhoo",
        "ހާ އަލިފު", "ހއ.", "ތިލަދުންމަތީ އުތުރު", "ދިއްދޫ", "އުތީމު", "ހޯރަފުށި", "އިހަވަންދޫ"),
    "Haa Dhaalu": (
        "Haa Dhaalu", "Haa Dhaal", "HDh Atoll", "South Thiladhunmathi", "Kulhudhuffushi", "Hanimaadhoo", "Nolhivaram", "Finey",
        "ހާ ދާލު", "ހދ.", "ތިލަދުންމަތީ ދެކުނު", "ކުޅުދުއްފުށި", "ހަނިމާދޫ", "ނޮޅިވަރަމް", "ފިނޭ"),
    "Shaviyani": (
        "Shaviyani", "North Miladhunmadulu", "Funadhoo", "Komandoo", "Milandhoo", "Feevah", "Foakaidhoo",
        "ށަވިޔަނި", "ށ.", "މިލަދުންމަޑުލު އުތުރު", "ފުނަދޫ", "ކޮމަންޑޫ", "މިލަންދޫ", "ފީވައް", "ފޯކައިދޫ"),
    "Noonu": (
        "Noonu Atoll", "South Miladhunmadulu", "Manadhoo", "Velidhoo", "Kendhikulhudhoo", "Holhudhoo", "Maafaru", "Kudafari", "Kanduhulhudhoo",
        "ނޫނު އަތޮޅު", "ނ.", "މިލަދުންމަޑުލު ދެކުނު", "މަނަދޫ", "ވެލިދޫ", "ކެނދިކުޅުދޫ", "ހޮޅުދޫ", "މާފަރު", "ކުޑަފަރި", "ކަނޑުހުޅުދޫ"),
    "Raa": (
        "Raa Atoll", "North Maalhosmadulu", "Ungoodhoo", "Ungoofaaru", "Dhuvaafaru", "Raa Meedhoo", "Alifushi",
        "ރާ އަތޮޅު", "ރ.", "މާޅޮސްމަޑުލު އުތުރު", "އުނގޫދޫ", "އުނގޫފާރު", "ދުވާފަރު", "ރ. މީދޫ", "އަލިފުށި"),
}
THAANA = re.compile(r"[\u0780-\u07a5]")
MAX_BYTES = 2_000_000
LIMIT = 120
MAX_AGE = timedelta(days=30)
DIRECT = {"Thiladhun": "https://thiladhun.com/feed/", "VNews": "https://www.vnews.mv/rss"}


def feeds():
    yield from ((name, url, None) for name, url in DIRECT.items())
    for region, aliases in REGIONS.items():
        for language in ("en", "dv"):
            terms = [term for term in aliases if bool(THAANA.search(term)) == (language == "dv") and not term.endswith(".")]
            query = "(" + " OR ".join(f'"{term}"' for term in terms) + ") when:30d"
            if language == "en":
                query += " Maldives"
            params = urlencode({"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"})
            yield f"Google News ({region}, {language})", f"https://news.google.com/rss/search?{params}", region


def safe_url(url):
    try:
        parsed = urlsplit(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.hostname) and not parsed.username
    except ValueError:
        return False


def match_region(text):
    for region, aliases in REGIONS.items():
        for alias in aliases:
            suffix = r"(?:ގެ|ގައި|އަށް|އިން|ން)?" if THAANA.search(alias) and not alias.endswith(".") else ""
            if re.search(r"(?<![\w\u0780-\u07bf])" + re.escape(alias) + suffix +
                         r"(?![\w\u0780-\u07bf])", text, re.IGNORECASE):
                return region
    return None


class FeedDescription(HTMLParser):
    """Extract visible text from the HTML fragments used in RSS descriptions."""

    def __init__(self):
        super().__init__()
        self.text = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        elif tag in {"br", "div", "p", "li"}:
            self.text.append(" ")

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.hidden:
            self.hidden -= 1
        elif tag in {"div", "p", "li"}:
            self.text.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.text.append(data)


def description_text(raw):
    parser = FeedDescription()
    parser.feed(raw[:8000])
    parser.close()
    return " ".join("".join(parser.text).split())


def prepare_draft(item, description=""):
    title = item["title"]
    publisher = item["source"]
    dhivehi = item["language"] == "dv"
    lead = (f'“{title}” މި ސުރުޚީގެ ދަށުން {publisher} އިން ޚަބަރު އެރުވިއެވެ.'
            if dhivehi else f'{publisher} reported the following: “{title}”')
    if (description and bool(THAANA.search(description)) == dhivehi
            and description.strip(".… ").casefold() != title.strip(".… ").casefold()):
        excerpt = description
        if len(excerpt) > 240:
            excerpt = excerpt[:241].rsplit(" ", 1)[0][:240].rstrip(" .…") + "…"
        attribution = "މަސްދަރުގެ ބައެއް" if dhivehi else "Source excerpt"
        return f'{lead}\n\n{attribution}: “{excerpt}”'
    return lead


def parse_feed(xml, source, region_hint, now):
    document = ET.fromstring(xml)
    if document.tag != "rss" or document.find("channel") is None:
        raise ValueError("Expected an RSS channel")
    for entry in document.findall("./channel/item"):
        title = " ".join(entry.findtext("title", "").split())
        url = entry.findtext("link", "").strip()
        publisher = " ".join(entry.findtext("source", source).split()) or source
        suffix = " - " + publisher
        if title.endswith(suffix):
            title = title[:-len(suffix)]
        try:
            published = parsedate_to_datetime(entry.findtext("pubDate", ""))
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
            published = published.astimezone(timezone.utc)
        except (ValueError, TypeError, OverflowError):
            continue
        if not title or not safe_url(url) or not now - MAX_AGE <= published <= now + timedelta(hours=24):
            continue
        region = match_region(title)
        if not region and not region_hint:
            region = match_region(" ".join(tag.text or "" for tag in entry.findall("category")))
        description = description_text(entry.findtext("description", "")) if not region_hint else ""
        if not region and description:
            region = match_region(description)
        if region:
            item = {"title": title[:500], "url": url, "source": publisher[:100],
                    "publishedAt": published.isoformat(), "region": region,
                    "language": "dv" if THAANA.search(title) else "en"}
            item["draft"] = prepare_draft(item, description)
            yield item



class ArticleRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, target):
        origin = urlsplit(request.full_url)
        destination = urlsplit(target)
        if not safe_url(target) or origin.netloc != destination.netloc or destination.scheme != "https":
            raise ValueError("Article redirected outside the publisher")
        return super().redirect_request(request, fp, code, msg, headers, target)


class ArticleParagraphs(FeedDescription):
    """Capture paragraphs in the publisher's article body."""

    def __init__(self):
        super().__init__()
        self.depth = 0
        self.paragraph = False
        self.paragraphs = []

    def handle_starttag(self, tag, attrs):
        if tag == "div":
            if self.depth or "article-body" in (dict(attrs).get("class") or "").split():
                self.depth += 1
        if self.depth and tag == "p":
            self.paragraph = True
            self.text.clear()
        if self.paragraph:
            super().handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self.paragraph:
            super().handle_endtag(tag)
            if tag == "p":
                self.paragraph = False
                self.paragraphs.append(" ".join("".join(self.text).split()))
        if tag == "div" and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if self.paragraph:
            super().handle_data(data)


def article_excerpts(html, language):
    parser = ArticleParagraphs()
    parser.feed(html)
    parser.close()
    paragraphs = list(dict.fromkeys(text for text in parser.paragraphs if len(text) >= 45))
    if len(paragraphs) < 2 or bool(THAANA.search(" ".join(paragraphs))) != (language == "dv"):
        return []
    # Publish only excerpts. The complete source text stays in the collector process.
    quote_budget = min(480, sum(map(len, paragraphs)) // 4)
    count = min(4, len(paragraphs), quote_budget // 45)
    if count < 2:
        return []
    per_paragraph = quote_budget // count
    excerpts = []
    for paragraph in paragraphs[:count]:
        if len(paragraph) > per_paragraph:
            paragraph = paragraph[:per_paragraph].rsplit(" ", 1)[0] + "…"
        excerpts.append(paragraph)
    return excerpts


def collect_article(item):
    url = item["url"]
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "thiladhun.com":
        return []
    try:
        opener = build_opener(ArticleRedirects())
        with opener.open(Request(url, headers={"User-Agent": "24-News-Control-Radar/1.0"}), timeout=12) as response:
            if response.headers.get_content_type() != "text/html":
                return []
            html = response.read(MAX_BYTES + 1)
            if len(html) <= MAX_BYTES:
                return article_excerpts(html.decode("utf-8", errors="replace"), item["language"])
    except (OSError, ValueError) as error:
        print(f"Article fetch failed for {parsed.path}: {error}", file=sys.stderr)
    return []


def enrich_articles(items, previous):
    cached = {item["url"]: item["articleExcerpts"] for item in previous if item.get("articleExcerpts")}
    for item in items:
        if item["url"] in cached:
            item["articleExcerpts"] = cached[item["url"]]
    candidates = [item for item in items if item["source"] == "Thiladhun" and not item.get("articleExcerpts")][:12]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for item, excerpts in zip(candidates, pool.map(collect_article, candidates)):
            if excerpts:
                item["articleExcerpts"] = excerpts


def collect(feed, now):
    name, url, region = feed
    try:
        with urlopen(Request(url, headers={"User-Agent": "24-News-Control-Radar/1.0"}), timeout=15) as response:
            xml = response.read(MAX_BYTES + 1)
        if len(xml) > MAX_BYTES or b"<!DOCTYPE" in xml.upper():
            raise ValueError("Unsupported RSS document")
        items = list(parse_feed(xml, name, region, now))
        print(f"{name}: {len(items)} leads")
        return items
    except (OSError, ET.ParseError, ValueError) as error:
        print(f"{name}: {error}", file=sys.stderr)
        return None


def merge(items, now):
    seen_urls = set()
    seen_headlines = set()
    result = []
    for item in sorted(items, key=lambda item: item["publishedAt"], reverse=True):
        if datetime.fromisoformat(item["publishedAt"]) < now - MAX_AGE:
            continue
        headline = (item["title"].casefold(), item["source"].casefold())
        if item["url"] in seen_urls or headline in seen_headlines:
            continue
        seen_urls.add(item["url"])
        seen_headlines.add(headline)
        result.append({**item, "draft": item.get("draft") or prepare_draft(item)})
        if len(result) == LIMIT:
            break
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("radar.json"))
    output = parser.parse_args().output
    now = datetime.now(timezone.utc)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda feed: collect(feed, now), feeds()))
    if all(result is None for result in results):
        sys.exit("All Radar feeds failed. Previous snapshot preserved.")
    previous = json.loads(output.read_text()) if output.exists() else {"items": []}
    fresh = [item for result in results if result is not None for item in result]
    items = merge([*fresh, *previous["items"]], now)
    enrich_articles(items, previous["items"])
    if items != previous["items"] or not previous.get("generatedAt"):
        temporary = output.with_suffix(".tmp")
        temporary.write_text(json.dumps({"generatedAt": now.isoformat(), "items": items}, ensure_ascii=False, indent=2) + "\n")
        temporary.replace(output)


if __name__ == "__main__":
    main()

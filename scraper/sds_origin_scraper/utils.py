from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Iterable, Iterator
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from bs4 import BeautifulSoup, NavigableString, Tag


WHITESPACE_RE = re.compile(r"\s+")
SKIP_TEXT_PARENTS = {"script", "style", "noscript", "svg", "template"}

WEAPON_TYPES = {
    "axe",
    "book",
    "grimoire",
    "cudgel",
    "nunchaku",
    "nunchucks",
    "dual swords",
    "gauntlets",
    "greatsword",
    "lance",
    "longsword",
    "rapier",
    "shield",
    "staff",
    "wand",
    "sword and shield",
}

ELEMENT_NAMES = {
    "fire",
    "ice",
    "cold",
    "thunder",
    "lightning",
    "earth",
    "wind",
    "dark",
    "darkness",
    "holy",
    "light",
    "physical",
}

SKILL_KINDS = {
    "adventure": "adventure",
    "adventure skill": "adventure",
    "passive": "passive",
    "normal": "normal_attack",
    "normal attack": "normal_attack",
    "special": "special_attack",
    "special attack": "special_attack",
    "skill": "normal_skill",
    "normal skill": "normal_skill",
    "tag": "tag_skill",
    "tag skill": "tag_skill",
    "ultimate": "ultimate",
    "ultimate move": "ultimate",
}

STAT_LABELS = {
    "attack",
    "defense",
    "max hp",
    "accuracy",
    "block",
    "crit rate",
    "crit damage",
    "crit res",
    "crit dmg res",
    "block dmg res",
    "move speed",
    "pvp dmg inc",
    "pvp dmg dec",
    "attack increase",
    "healing efficiency",
    "burst efficiency",
}


def normalize_space(value: str) -> str:
    return WHITESPACE_RE.sub(" ", value or "").strip()


def normalize_url(base_url: str, href: str) -> str:
    absolute = urljoin(base_url, href)
    parsed = urlparse(absolute)
    cleaned = parsed._replace(fragment="")
    path = cleaned.path or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    if cleaned.query:
        cleaned = cleaned._replace(query=urlencode(sorted(parse_qsl(cleaned.query, keep_blank_values=True))))
    cleaned = cleaned._replace(path=path)
    return urlunparse(cleaned)


def slug_from_url(url: str) -> str:
    path = urlparse(url).path.rstrip("/")
    if not path:
        return "home"
    return path.split("/")[-1] or "home"


def domain_for(url: str) -> str:
    return urlparse(url).netloc.lower()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def write_jsonl(path: Path, rows: Iterable[dict], mode: str = "w") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open(mode, encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def soup_text(soup: BeautifulSoup) -> str:
    return normalize_space(soup.get_text(" ", strip=True))


def collect_links(soup: BeautifulSoup, base_url: str) -> list[tuple[str, str]]:
    results: list[tuple[str, str]] = []
    seen: set[str] = set()
    for anchor in soup.select("a[href]"):
        href = anchor.get("href", "")
        if not href or href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        url = normalize_url(base_url, href)
        if url in seen:
            continue
        seen.add(url)
        results.append((url, normalize_space(anchor.get_text(" ", strip=True))))
    return results


def collect_images(soup: BeautifulSoup, base_url: str) -> list[tuple[str, str]]:
    results: list[tuple[str, str]] = []
    seen: set[str] = set()
    for image in soup.select("img[src]"):
        src = image.get("src", "")
        if not src:
            continue
        url = normalize_url(base_url, src)
        if url in seen:
            continue
        seen.add(url)
        alt = normalize_space(image.get("alt", ""))
        results.append((url, alt))
    return results


def find_best_h1(soup: BeautifulSoup) -> str:
    tag = soup.find("h1")
    if tag:
        return normalize_space(tag.get_text(" ", strip=True))
    title = soup.find("title")
    if title:
        return normalize_space(title.get_text(" ", strip=True))
    return ""


def title_text(soup: BeautifulSoup) -> str:
    tag = soup.find("title")
    return normalize_space(tag.get_text(" ", strip=True)) if tag else ""


def first_nonempty(values: Iterable[str]) -> str:
    for value in values:
        if value:
            return value
    return ""


def clean_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value)
    return value.strip("_") or "output"


def visible_text_blocks(soup: BeautifulSoup) -> list[str]:
    blocks: list[str] = []
    for node in soup.select("h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, figcaption"):
        text = normalize_space(node.get_text(" ", strip=True))
        if text:
            blocks.append(text)
    return blocks


def is_same_domain(url: str, allowed_domains: set[str]) -> bool:
    host = domain_for(url)
    return host in allowed_domains or any(host.endswith(f".{d}") for d in allowed_domains)


def text_after_heading(heading: Tag) -> list[str]:
    body: list[str] = []
    for sib in heading.next_siblings:
        if isinstance(sib, Tag) and sib.name and re.fullmatch(r"h[1-6]", sib.name):
            break
        if isinstance(sib, Tag):
            text = normalize_space(sib.get_text(" ", strip=True))
            if text:
                body.append(text)
    return body


def traverse_dom_tokens(root: Tag) -> list[dict[str, str]]:
    tokens: list[dict[str, str]] = []

    def walk(node: Tag | NavigableString) -> None:
        if isinstance(node, NavigableString):
            parent = node.parent.name if node.parent else ""
            if parent in SKIP_TEXT_PARENTS:
                return
            text = normalize_space(str(node))
            if text:
                tokens.append({"kind": "text", "text": text})
            return
        if not isinstance(node, Tag):
            return
        if node.name in SKIP_TEXT_PARENTS:
            return
        if node.name == "img":
            alt = normalize_space(node.get("alt", ""))
            src = normalize_space(node.get("src", ""))
            if alt or src:
                tokens.append({"kind": "image", "text": alt, "src": src})
        for child in node.children:
            walk(child)

    walk(root)
    return tokens


def token_texts(tokens: list[dict[str, str]]) -> list[str]:
    return [normalize_space(t.get("text", "")) for t in tokens if normalize_space(t.get("text", ""))]


def normalize_name_key(value: str) -> str:
    value = normalize_space(value).lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def canonical_weapon_type(value: str) -> str:
    value = normalize_space(value)
    mapping = {
        "book": "book",
        "grimoire": "book",
        "cudgel": "cudgel",
        "nunchaku": "cudgel",
        "nunchucks": "cudgel",
        "sword and shield": "shield",
    }
    key = value.lower()
    return mapping.get(key, value)


def canonical_element(value: str) -> str:
    value = normalize_space(value)
    mapping = {"cold": "ice", "lightning": "thunder", "light": "holy", "darkness": "dark"}
    return mapping.get(value.lower(), value)


def is_weapon_type(value: str) -> bool:
    return normalize_space(value).lower() in WEAPON_TYPES


def is_element_name(value: str) -> bool:
    return normalize_space(value).lower() in ELEMENT_NAMES


def maybe_skill_kind(value: str) -> str | None:
    return SKILL_KINDS.get(normalize_space(value).lower())


def is_stat_label(value: str) -> bool:
    return normalize_space(value).lower() in STAT_LABELS


def pick_first_image_by_alt(images: list[tuple[str, str]], target: str) -> str:
    target_key = normalize_name_key(target)
    for src, alt in images:
        if normalize_name_key(alt) == target_key:
            return src
    return ""


def pick_first_image_by_alt_many(images: list[tuple[str, str]], candidates: Iterable[str]) -> str:
    keys = {normalize_name_key(c) for c in candidates}
    for src, alt in images:
        if normalize_name_key(alt) in keys:
            return src
    return ""


def chunked(seq: list, size: int) -> Iterator[list]:
    for idx in range(0, len(seq), size):
        yield seq[idx : idx + size]


def extract_repeated_token(lines: list[str], candidates: set[str]) -> str:
    counts = Counter(normalize_space(line) for line in lines if normalize_space(line).lower() in candidates)
    if not counts:
        return ""
    return counts.most_common(1)[0][0]


def parse_labeled_stats(lines: list[str]) -> dict[str, str]:
    stats: dict[str, str] = {}
    for i in range(len(lines) - 1):
        label = normalize_space(lines[i])
        value = normalize_space(lines[i + 1])
        if is_stat_label(label) and value and value != label:
            stats[label.lower().replace(" ", "_")] = value
    return stats


def unique_preserve(values: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        value = normalize_space(value)
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def merge_lists(*iterables: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for iterable in iterables:
        for item in iterable:
            item = normalize_space(item)
            if not item or item in seen:
                continue
            seen.add(item)
            out.append(item)
    return out

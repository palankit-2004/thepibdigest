import os
import re
import json
import time
from datetime import datetime, timezone
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

START_PAGE = "https://www.pib.gov.in/Allrel.aspx?lang=1&reg=3"
BASE = "https://www.pib.gov.in/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

ALLOW_MINISTRIES = {
    "Ministry of Defence",
    "Ministry of Home Affairs",
    "Ministry of External Affairs",
    "Ministry of Finance",
    "Ministry of Law and Justice",
    "Ministry of Environment, Forest and Climate Change",
    "Ministry of Health and Family Welfare",
    "Ministry of Education",
    "Ministry of Agriculture & Farmers Welfare",
    "Ministry of Railways",
    "Ministry of Road Transport and Highways",
    "Ministry of Power",
    "Ministry of Petroleum and Natural Gas",
    "Ministry of Commerce and Industry",
    "Ministry of Electronics & IT",
    "Ministry of Science & Technology",
    "Ministry of Labour & Employment",
    "Ministry of Rural Development",
    "Ministry of Housing and Urban Affairs",
    "Ministry of Women and Child Development",
    "Ministry of Social Justice and Empowerment",
    "Ministry of Tribal Affairs",
    "Ministry of Consumer Affairs, Food and Public Distribution",
    "Ministry of Parliamentary Affairs",
    "Ministry of Civil Aviation",
    "Ministry of Coal",
    "Ministry of Heavy Industries",
    "Ministry of Panchayati Raj",
    "Ministry of Jal Shakti",
    "Ministry of Information & Broadcasting",
    "NITI Aayog",
}

MAX_RELEASE_LINKS = 700
DELAY_SEC = 0.65

OUT_DIR = os.path.join("public", "data")
OUT_INDEX = os.path.join(OUT_DIR, "index.json")
OUT_ITEMS = os.path.join(OUT_DIR, "items")


def headers(referer: str) -> dict:
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "Referer": referer,
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }


def atomic_write_json(path: str, obj: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def clean_text(s: str) -> str:
    s = s.replace("\r", "").replace("\t", " ")
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)

    out_lines = []
    for line in s.split("\n"):
        line = re.sub(r"\s+$", "", line)
        line = re.sub(r"^\s{2,}", "", line)
        line = re.sub(r" {2,}", " ", line)
        out_lines.append(line)

    return "\n".join(out_lines).strip()


def snippet(text: str, n=420) -> str:
    t = re.sub(r"\s+", " ", (text or "")).strip()
    return (t[:n] + "…") if len(t) > n else t


def extract_prid(url: str) -> str | None:
    m = re.search(r"PRID=(\d+)", url)
    return m.group(1) if m else None


def absolutize(href: str) -> str:
    href = (href or "").strip()
    if href.startswith("http"):
        return href
    return urljoin(BASE, href)


def fetch_html(session: requests.Session, url: str, referer: str) -> str:
    r = session.get(url, headers=headers(referer), timeout=45, allow_redirects=True)
    r.raise_for_status()
    return r.text or ""


def collect_release_links(session: requests.Session) -> list[str]:
    html = fetch_html(session, START_PAGE, BASE)
    soup = BeautifulSoup(html, "lxml")

    links = []
    seen = set()

    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if "PressReleasePage.aspx" in href and "PRID=" in href:
            full = absolutize(href)
            prid = extract_prid(full)
            if prid and prid not in seen:
                seen.add(prid)
                links.append(full)

    return links[:MAX_RELEASE_LINKS]


def detect_ministry(soup: BeautifulSoup) -> str | None:
    lines = [t.strip() for t in soup.get_text("\n").split("\n")]
    lines = [t for t in lines if t and len(t) < 220]
    for t in lines[:320]:
        if t.startswith("Ministry of "):
            return t
        if t == "NITI Aayog":
            return t
    return None


def extract_title(soup: BeautifulSoup) -> str:
    h = soup.find(["h2", "h1"])
    if h:
        t = h.get_text(" ", strip=True)
        if t:
            return t
    return "Untitled"


def extract_posted_on(soup: BeautifulSoup) -> str:
    text = soup.get_text(" ")
    m = re.search(r"Posted On:\s*(.+?)\s*by\s", text, flags=re.IGNORECASE)
    return m.group(1).strip() if m else ""


def extract_pdfs(soup: BeautifulSoup) -> list[dict]:
    pdfs = []
    for a in soup.select("a[href]"):
        href = (a.get("href") or "").strip()
        if ".pdf" in href.lower():
            label = a.get_text(" ", strip=True) or "PDF"
            pdfs.append({"label": label[:60], "url": absolutize(href)})

    seen = set()
    out = []
    for p in pdfs:
        u = p.get("url")
        if u and u not in seen:
            seen.add(u)
            out.append(p)
    return out[:12]


def scrape_release(session: requests.Session, url: str) -> dict | None:
    html = fetch_html(session, url, START_PAGE)
    if len(html) < 800:
        return None

    soup = BeautifulSoup(html, "lxml")

    prid = extract_prid(url)
    if not prid:
        return None

    ministry = detect_ministry(soup)
    if ministry not in ALLOW_MINISTRIES:
        return None

    title = extract_title(soup)
    posted = extract_posted_on(soup)
    pdfs = extract_pdfs(soup)
    full_text = clean_text(soup.get_text("\n"))

    return {
        "prid": str(prid),
        "ministry": ministry,
        "title": title,
        "posted_on_raw": posted,
        "source_url": url,
        "pdfs": pdfs,
        "text": full_text,
    }


def main():
    os.makedirs(OUT_ITEMS, exist_ok=True)

    # Read previous index (for fallback)
    prev_index = None
    if os.path.exists(OUT_INDEX):
        try:
            with open(OUT_INDEX, "r", encoding="utf-8") as f:
                prev_index = json.load(f)
        except Exception:
            prev_index = None

    s = requests.Session()

    # warm up
    try:
        s.get(BASE, headers=headers(BASE), timeout=30)
    except Exception:
        pass

    # collect links
    try:
        links = collect_release_links(s)
    except Exception as e:
        print("⚠️ Failed to collect release links:", e)
        links = []

    if not links:
        # Keep old data if available
        if prev_index and int(prev_index.get("count", 0)) > 0:
            print("⚠️ No links collected. Keeping previous index.json (no overwrite).")
            return

        # Otherwise write a valid empty index (first run)
        atomic_write_json(OUT_INDEX, {
            "updated_at_utc": datetime.now(timezone.utc).isoformat(),
            "count": 0,
            "items": [],
            "note": "No release links found. PIB may be blocking requests."
        })
        print("⚠️ No links found; wrote empty index.json.")
        return

    index_items = []
    seen = set()

    for url in links:
        try:
            data = scrape_release(s, url)
            time.sleep(DELAY_SEC)

            if not data:
                continue

            prid = data["prid"]
            if prid in seen:
                continue
            seen.add(prid)

            detail_path = os.path.join(OUT_ITEMS, f"{prid}.json")
            detail_obj = {
                "prid": data["prid"],
                "ministry": data["ministry"],
                "title": data["title"],
                "posted_on_raw": data["posted_on_raw"],
                "source_url": data["source_url"],
                "pdfs": data.get("pdfs", []),
                "text": data.get("text", ""),
                "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
            }
            atomic_write_json(detail_path, detail_obj)

            index_items.append({
                "prid": detail_obj["prid"],
                "ministry": detail_obj["ministry"],
                "title": detail_obj["title"],
                "posted_on_raw": detail_obj["posted_on_raw"],
                "source_url": detail_obj["source_url"],
                "pdfs": detail_obj["pdfs"],
                "snippet": snippet(detail_obj["text"]),
            })

        except Exception:
            continue

    new_count = len(index_items)

    # If scrape returned 0, keep old data (do not overwrite)
    if new_count == 0 and prev_index and int(prev_index.get("count", 0)) > 0:
        print("⚠️ Scrape returned 0 items. Keeping previous index.json (no overwrite).")
        return

    atomic_write_json(OUT_INDEX, {
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        "count": new_count,
        "items": index_items
    })

    print(f"✅ Collected release links: {len(links)}")
    print(f"✅ Written index items: {new_count}")


if __name__ == "__main__":
    main()

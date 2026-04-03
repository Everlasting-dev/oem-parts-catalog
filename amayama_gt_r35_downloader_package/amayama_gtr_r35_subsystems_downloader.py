#!/usr/bin/env python3
"""
Download Amayama subsystem pages for:
Nissan GT-R R35 / 614-vr38dett

What this does
- Opens the catalog page in a real Chromium browser via Playwright
- Lets you solve cookie prompts / CAPTCHA manually if needed
- Collects all subsystem links from the page
- Saves:
  * raw HTML snapshot for each subsystem page
  * plain-text snapshot for each subsystem page
  * manifest.json
  * manifest.csv
  * local index.html

Notes
- This is meant to run on *your* computer with internet access.
- It uses a real browser because Amayama may block plain HTTP scraping.
- Saved HTML files are snapshots. Some images/styles may still load remotely.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
except Exception:
    print("Playwright is not installed.")
    print("Install it with:")
    print("  pip install playwright")
    print("  playwright install chromium")
    sys.exit(1)

MAIN_URL = "https://www.amayama.com/en/genuine-catalogs/epc/nissan-usa/gt-r/r35/614-vr38dett"
LINK_RE = re.compile(
    r"^https://www\.amayama\.com/en/genuine-catalogs/epc/nissan-usa/gt-r/r35/614-vr38dett/[^/]+/\d{3}$"
)

def slugify(text: str, max_len: int = 80) -> str:
    text = re.sub(r"\s+", " ", text.strip())
    text = re.sub(r"[^A-Za-z0-9._ -]+", "", text)
    text = text.replace(" - ", "_").replace(" ", "_")
    text = re.sub(r"_+", "_", text).strip("._-")
    return text[:max_len] or "page"

def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())

def wait_for_user(prompt: str) -> None:
    try:
        input(prompt)
    except KeyboardInterrupt:
        print("\nAborted.")
        sys.exit(1)

def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", errors="replace")

def collect_subsystem_links(page) -> List[Dict[str, str]]:
    items = page.evaluate(
        """
        () => {
          const rows = [...document.querySelectorAll('a[href]')].map(a => ({
            href: a.href,
            text: (a.textContent || '').replace(/\\s+/g, ' ').trim()
          }));
          return rows;
        }
        """
    )
    results = []
    seen = set()
    for item in items:
        href = (item.get("href") or "").strip()
        text = normalize_text(item.get("text") or "")
        if LINK_RE.match(href) and href not in seen:
            seen.add(href)
            code = href.rstrip("/").split("/")[-1]
            title = text
            results.append({
                "code": code,
                "title": title,
                "url": href,
            })
    return sorted(results, key=lambda x: (int(x["code"]), x["url"]))

def build_index(manifest: List[Dict[str, str]], output_dir: Path) -> str:
    rows = []
    for item in manifest:
        html_name = item.get("html_file", "")
        txt_name = item.get("text_file", "")
        status = item.get("status", "unknown")
        code = item.get("code", "")
        title = item.get("title", "")
        source = item.get("url", "")
        rows.append(
            f"<tr>"
            f"<td>{code}</td>"
            f"<td>{title}</td>"
            f"<td>{status}</td>"
            f"<td><a href='{html_name}'>HTML</a></td>"
            f"<td><a href='{txt_name}'>TXT</a></td>"
            f"<td><a href='{source}'>Source</a></td>"
            f"</tr>"
        )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Amayama GT-R R35 Subsystem Export</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border: 1px solid #ccc; padding: 8px; text-align: left; vertical-align: top; }}
    th {{ background: #f3f3f3; }}
    code {{ background: #f5f5f5; padding: 2px 4px; }}
  </style>
</head>
<body>
  <h1>Amayama GT-R R35 Subsystem Export</h1>
  <p>Catalog root: <a href="{MAIN_URL}">{MAIN_URL}</a></p>
  <p>Generated: {datetime.now(timezone.utc).isoformat()}</p>
  <table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Title</th>
        <th>Status</th>
        <th>HTML</th>
        <th>TXT</th>
        <th>Source</th>
      </tr>
    </thead>
    <tbody>
      {''.join(rows)}
    </tbody>
  </table>
</body>
</html>"""

def main() -> int:
    parser = argparse.ArgumentParser(description="Download Amayama GT-R subsystem pages with Playwright.")
    parser.add_argument("--output", default="amayama_gtr_r35_export", help="Output folder")
    parser.add_argument("--headless", action="store_true", help="Run browser headless")
    parser.add_argument("--wait-seconds", type=int, default=0, help="Extra wait after opening main page")
    parser.add_argument(
        "--user-data-dir",
        default="amayama_profile",
        help="Browser profile folder to keep cookies/login state"
    )
    args = parser.parse_args()

    output_dir = Path(args.output).resolve()
    html_dir = output_dir / "html"
    txt_dir = output_dir / "text"
    output_dir.mkdir(parents=True, exist_ok=True)
    html_dir.mkdir(parents=True, exist_ok=True)
    txt_dir.mkdir(parents=True, exist_ok=True)

    manifest: List[Dict[str, str]] = []

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=args.user_data_dir,
            headless=args.headless,
            viewport={"width": 1440, "height": 1200},
            accept_downloads=False,
        )
        page = context.new_page()
        page.set_default_timeout(30000)

        print(f"Opening main catalog page:\n  {MAIN_URL}")
        page.goto(MAIN_URL, wait_until="domcontentloaded")

        if args.wait_seconds > 0:
            print(f"Waiting {args.wait_seconds}s...")
            time.sleep(args.wait_seconds)

        print("\nIf you see cookie prompts or CAPTCHA, solve them in the browser.")
        wait_for_user("When the page is ready and the subsystem list is visible, press Enter... ")

        try:
            page.wait_for_selector("a[href]", timeout=10000)
        except PlaywrightTimeoutError:
            print("Could not detect links on the page. Save failed.")
            context.close()
            return 2

        # Save main page snapshots too
        main_html = page.content()
        main_text = page.evaluate("() => document.body ? document.body.innerText : ''")
        write_text(output_dir / "main_catalog.html", main_html)
        write_text(output_dir / "main_catalog.txt", main_text)

        links = collect_subsystem_links(page)
        print(f"Found {len(links)} subsystem links.")

        if not links:
            print("No subsystem links were found. The page may not have loaded fully.")
            context.close()
            return 3

        for idx, item in enumerate(links, start=1):
            code = item["code"]
            title = item["title"] or code
            url = item["url"]
            base_name = f"{code}_{slugify(title)}"
            html_file = f"{base_name}.html"
            txt_file = f"{base_name}.txt"

            record = {
                "index": idx,
                "code": code,
                "title": title,
                "url": url,
                "html_file": f"html/{html_file}",
                "text_file": f"text/{txt_file}",
                "status": "pending",
                "error": "",
            }

            print(f"[{idx}/{len(links)}] {code} - {title}")
            try:
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_selector("body", timeout=10000)

                html = page.content()
                text = page.evaluate("() => document.body ? document.body.innerText : ''")

                header = (
                    f"<!-- Saved from: {url} -->\n"
                    f"<!-- Saved at: {datetime.now(timezone.utc).isoformat()} -->\n"
                )
                write_text(html_dir / html_file, header + html)
                write_text(txt_dir / txt_file, f"Source: {url}\n\n{text}")

                record["status"] = "saved"
            except Exception as exc:
                record["status"] = "error"
                record["error"] = str(exc)
                write_text(txt_dir / txt_file, f"FAILED: {url}\n\n{exc}\n")

            manifest.append(record)
            time.sleep(0.5)

        write_text(output_dir / "manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))

        with (output_dir / "manifest.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["index", "code", "title", "url", "html_file", "text_file", "status", "error"]
            )
            writer.writeheader()
            writer.writerows(manifest)

        write_text(output_dir / "index.html", build_index(manifest, output_dir))

        print("\nDone.")
        print(f"Output folder: {output_dir}")
        saved = sum(1 for x in manifest if x["status"] == "saved")
        failed = sum(1 for x in manifest if x["status"] == "error")
        print(f"Saved: {saved}")
        print(f"Failed: {failed}")

        context.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

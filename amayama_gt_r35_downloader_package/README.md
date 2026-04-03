# Amayama GT-R R35 subsystem downloader

This package includes a Python script that opens the Amayama catalog in a real Chromium browser, collects the subsystem links, and saves each subsystem page locally as:
- HTML snapshot
- plain-text snapshot
- CSV/JSON manifest
- local index page

## Why this script exists
The catalog page for the 2019 GT-R R35 Track VR38DETT GR6 exposes a long subsystem list from the main catalog page. Examples on the page include `101 - BARE & SHORT ENGINE`, `102 - ENGINE GASKET KIT`, `110 - CYLINDER BLOCK & OIL PAN`, and many more. The page is the Amayama catalog root for Nissan GT-R R35, 11.2014 to 04.2019, Track, VR38DETT, GR6. citeturn991267view0turn741010view0turn741010view1

## Install
```bash
pip install playwright
playwright install chromium
```

## Run
```bash
python amayama_gtr_r35_subsystems_downloader.py
```

The browser will open. If Amayama shows cookie prompts or CAPTCHA, solve them, make sure the subsystem list is visible, then press Enter in the terminal.

## Output
The script creates:
- `main_catalog.html`
- `main_catalog.txt`
- `manifest.json`
- `manifest.csv`
- `index.html`
- `html/` folder with subsystem snapshots
- `text/` folder with subsystem text dumps

## Useful options
```bash
python amayama_gtr_r35_subsystems_downloader.py --output my_export
python amayama_gtr_r35_subsystems_downloader.py --headless
python amayama_gtr_r35_subsystems_downloader.py --user-data-dir my_browser_profile
```

## Reality check
These are snapshots, not perfect “Save Page Complete” archives. Some images or styling may still point to the live site. But the page content and table text should still be captured.

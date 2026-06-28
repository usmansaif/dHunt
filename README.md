<p align="center">
  <img src="icons/icon128.png" alt="dHunt logo" width="96" />
</p>

<h1 align="center">dHunt — Daraz Product Hunter</h1>

<p align="center">A Chrome extension (Manifest V3) that autonomously browses <a href="https://www.daraz.pk">Daraz.pk</a>, extracts product data across multiple pages, scores each product by demand, and surfaces the best opportunities in a clean dashboard.</p>

## Features

- **Automated hunting** — opens a background tab, scrapes search result pages, and enriches each product with detail-page data
- **Demand scoring** — ranks products 0–100 based on reviews, rating, stock status, discount, and Daraz Mall badge
- **TOP picks** — best 5 products (score ≥ 25) pinned to the top of results with a gold separator
- **Configurable filters** — max pages/products, price range, sort order, min rating/reviews, brand filter, free shipping, keyword include/exclude
- **Resume after interrupt** — if the browser closes mid-hunt, the extension detects it on next start and offers Resume or Restart
- **Hunt history** — last 20 hunts stored locally; load any past result set with one click
- **Dark / Light / System theme** — toggleable from both the popup and dashboard
- **CSV export** — download full results including all extended product fields

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest — permissions, host rules, service worker |
| `background.js` | Orchestration, config, hunt lifecycle, resume logic |
| `content.js` | Page scrapers — listings, product details, pagination |
| `popup.html` / `popup.js` | Compact popup — start hunt, progress, interrupted banner |
| `dashboard.html` / `logs.js` | Full dashboard — Hunt, Logs, Results, History, Settings tabs |
| `theme-init.js` | Flicker-free theme injection before first paint |
| `icons/` | Extension icons (16 / 32 / 48 / 128 px) |

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `dHunt` folder.
5. The dHunt icon appears in the toolbar.

## Usage

1. Click the dHunt toolbar icon.
2. Type a product keyword (e.g. `wireless earbuds`) and click **Start Hunt**.
3. A progress bar shows live status; use **Pause** / **Stop** at any time.
4. When the hunt completes, click **View Results ↗** to open the dashboard.
5. In the dashboard, switch to the **Results** tab to see scored products — TOP picks are pinned at the top.
6. Use the **History** tab to reload any previous hunt.
7. Adjust scraping behaviour in the **Settings** tab.

## Demand Score (0–100)

| Signal | Max Points |
|--------|-----------|
| Review count (caps at 200 reviews) | 50 |
| Rating (5 ★ = max) | 25 |
| Stock status (low stock / in stock) | 15 |
| Discount % | 5 |
| Daraz Mall badge | 5 |

## Data Collected

**Core:** title, URL, price, original price, discount %, rating, review count, stock status, Daraz Mall flag, seller, free shipping

**Extended (from product detail page):** category, brand, image count, video available, description length, specifications count, variants count

**Computed:** demand score

## Configuration (Settings Tab)

| Setting | Default | Description |
|---------|---------|-------------|
| Max Pages | 5 | Search result pages to scrape |
| Max Products | 50 | Products to enrich with detail data |
| Sort By | popularity | Daraz sort order for results |
| Price Min / Max | — | Filter by price range (PKR) |
| Min Rating | 0 | Skip products below this rating |
| Min Reviews | 0 | Skip products with fewer reviews |
| Brand Filter | any | any / branded / no-brand |
| Min Images | 0 | Skip products with fewer images |
| Free Shipping | off | Only include free-shipping products |
| Keyword Include | — | Title must contain this word |
| Keyword Exclude | — | Title must not contain this word |

## Permissions

| Permission | Reason |
|-----------|--------|
| `tabs` | Open and manage the background hunt tab |
| `storage` | Persist state, config, and hunt history |
| `scripting` | Inject content scripts into Daraz pages |
| `alarms` | Keep the service worker alive during long hunts |
| `notifications` | Notify when a hunt completes |
| `*://*.daraz.pk/*` | Access Daraz product and search pages |

## Architecture Notes

- All state lives in `chrome.storage.local` (`dhunt_state`) — survives popup close and browser restart.
- Config lives separately in `dhunt_config` so settings persist across hunts.
- The service worker stays alive via `chrome.alarms` firing every 24 seconds.
- Browser restart mid-hunt is detected via `chrome.runtime.onStartup` checking for `status: running` in storage.

## Version History

| Version | Changes |
|---------|---------|
| 0.2.0 | Config/settings panel, resume-after-interrupt, extended product data, history load fix, TOP pinning |
| 0.1.0 | 7-phase MVP: skeleton → search → enrich → UI → scoring → history → safety |

## Author

**Usman Saif**
- Email: [usman.saif22@gmail.com](mailto:usman.saif22@gmail.com)
- GitHub: [@usman-saif22](https://github.com/usman-saif22)
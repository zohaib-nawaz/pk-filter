# PK Access Filter

A Chrome extension that marks each Google Search result as **Accessible**, **Blocked**, **Possibly blocked**, **Unknown** or **Server error** from Pakistan (or from whichever country you, or your VPN, are in), and can hide results with confirmed blocking evidence.

It is an accessibility checker, not a VPN or proxy. Nothing is hidden unless the user picks a filter.

## How it works

```
Google Search page                Chrome extension                     Backend on a Pakistan VPS
──────────────────                ────────────────                     ─────────────────────────
content.js  ── domains ──▶  background.js (cache, batching,  ── POST /api/v1/check ──▶  Fastify API
  badges, filter, notice        backoff, chrome.storage)                                 ├─ DNS check (system resolver + DoH control)
  ◀── results ────────────                                  ◀── evidence + status ───   ├─ HTTPS / HTTP check (SSRF-safe, ≤5 redirects)
                                                                                         ├─ OONI aggregation API (30 days, cached 12h)
popup / options (React + Tailwind) ◀── chrome.storage.sync ──▶ settings                 ├─ classification engine
                                                                                         └─ Postgres (optional) evidence history
```

The backend runs **on the Pakistan VPS itself**, so its DNS and HTTP checks are the Pakistan probe. No separate probe service is needed.

### Classification rules

| Status | When |
|---|---|
| Blocked | Pakistani block page seen, or live failure + OONI confirmed blocking in the last 7 days, or live interference + ≥70% OONI anomalies (≥5 measurements) |
| Possibly blocked | DNS manipulation (local answer missing/private while an independent DoH resolver has a public answer), HTTPS reset, HTTP 451, or ≥50% recent OONI anomalies |
| Accessible | Site answered from Pakistan (2xx/3xx, also 401/403/404, since the site responded) |
| Server error | Site answered with 5xx |
| Unknown | Timeouts, TLS errors, domain missing everywhere, no data |

DNS failure alone, a timeout alone, or any single HTTP status code is never treated as blocking. A live success always wins over historical OONI data. Every evidence record is stored (when Postgres is configured) so results can be re-classified later.

Cache durations: accessible 20 min, blocked / possibly blocked 15 min, server error 10 min, unknown 5 min, OONI history 12 h. The extension caches the same durations in `chrome.storage.local` (users can raise the minimum in Settings).

## Search engines, site status and ISPs

- **Google, Bing and DuckDuckGo** results all get badges and filtering. Bing's `bing.com/ck/a` redirect links are decoded (`u=a1…`), falling back to the displayed URL.
- **Popup → This site** shows the open tab's status (needs only `activeTab`), when it was checked, each ISP's result, the last 30 days of history and, for blocked sites, an archived copy (web.archive.org) and the OONI Explorer evidence page. Clicking a blocked badge in search results also opens the archived copy.
- **Several ISPs.** Run the same backend on VPSes in other Pakistani networks (each with its own `PROBE_ISP`/`PROBE_ASN` and the same `PROBE_TOKEN`), then list them on the main server in `PEER_PROBES=https://jazz-probe.example.com,https://zong-probe.example.com`. The main server asks every peer through the token-protected `POST /api/v1/probe`, returns `networks` per result, and combines them: blocked only when every measured network blocks the site, "possibly blocked (some ISPs)" when they disagree. With no peers the API answers exactly as before.
- **Settings → Measurement network** lets users follow one ISP's result instead of the combined one.
- **History** comes from `GET /api/v1/history?domain=…` (last 30 days, worst status per day, and `blockedSince` for the current blocking streak). It needs `DATABASE_URL`; without a database the popup simply hides the history strip.

## Any country, VPN included

- **Settings → Country** is **Automatic** by default. The backend works out the country from the request's IP address (a `CF-IPCountry` header when `TRUST_PROXY=true` behind Cloudflare, otherwise a local DB-IP country database), so turning on a VPN switches the country to the VPN's exit country. Users can also pick a country by hand.
- **Pakistan** (the probe's own `PROBE_COUNTRY`) works exactly as before: live DNS/HTTP probe plus OONI.
- **A country with its own test server**: add it to `PEER_PROBES` with a country prefix, for example `PEER_PROBES=https://jazz-probe.example.com,DE=https://de-probe.example.com`. Entries without a prefix are other ISPs in the main country. If that server is down, OONI reports are used.
- **Any other country** uses OONI volunteer measurements from that country from the last 7 days, judged by share rather than by single reports: at least half confirmed blocked → Blocked; 70%+ problems (anomaly or confirmed) with 5+ measurements → Blocked if any are confirmed, else Possibly blocked; 20%+ problems → Possibly blocked; otherwise Accessible (a few blocked networks, such as schools or offices, are noted but do not flip the result); no recent data → Unknown, never a guessed "Accessible". These results carry the `ooni_only` evidence and lower confidence.
- **Also check from my own connection** (Settings, on by default, can be turned off): the browser tries `https://site/` and `https://www.site/` itself (no cookies, 8 s timeout, 4 at a time, remembered for 10 minutes). If it opens, the result becomes Accessible; if it fails, it becomes Possibly blocked, or stays Blocked when the server already says so. Because this goes through the VPN when one is on, it answers "does it open for me right now". Each site sees that connection, like a visit.
- The extension caches results per country and asks `GET /api/v1/whereami` at most once a minute. When the country changes (VPN on/off), open search pages re-check automatically. The popup shows "Country: Germany (from your IP)" and Settings shows which source is used.
- Set up GeoIP once with `npm run geoip:update` in `backend/` (downloads [IP to Country Lite by DB-IP](https://db-ip.com), CC BY 4.0, about 8 MB, into `backend/data/`) and `GEOIP_DB=data/dbip-country-lite.mmdb`. Re-run it monthly; the server reloads the file on change. Without it, every request falls back to `PROBE_COUNTRY`. When the server can only see a local or unknown address (for example a backend on `localhost`, or a proxy without `TRUST_PROXY`), the extension reads the country from `https://www.cloudflare.com/cdn-cgi/trace` (`loc=`) in the browser instead, which also goes through the VPN.

## When a site does not open

- **Right-click → "Check if this link is blocked"** (or "Check if this site is blocked" on a page) opens a small window with the same status card as the popup: per-ISP results, 30-day history and an archived copy for blocked sites. Needs only `contextMenus`, which shows no install warning.
- **Settings → Explain sites that fail to load** (off by default) asks for the optional `webNavigation` permission. When a page fails with a blocking-like network error (connection reset/closed/refused/timed out, name not resolved, TLS failure; plus the Firefox equivalents), the tab switches to a page that says what went wrong, whether the site is blocked in the current country, and offers **Try again** and the archived copy. Errors such as `ERR_ABORTED`, blocked-by-client or "no internet" are left alone. Only the failing site's domain is checked. The page is shown once per site per tab, so Back and **Try again** show the browser's own error instead of looping, and incognito tabs are skipped.

## Video downloader (optional)

Off by default. Turn it on in **Settings → Video downloader**; Chrome then asks for `downloads`, `notifications`, `scripting` and site access. Turning it off removes those permissions again.

| Setting | What it does |
|---|---|
| Enable video downloader | Master switch, requests/removes permissions |
| Icons on Google results | Download pill for direct video links; "Streaming only" tag for YouTube/Vimeo/TikTok-style results |
| Icons on video pages | Registers `video.js` on all sites; adds a download icon on `<video>` players and direct video links |
| Show not-downloadable icons | Off by default. When on, streaming/DRM videos and Google streaming results get a grey icon explaining why they can't be downloaded |

Supported files: video MP4, M4V, WebM, MOV, OGV, MKV, AVI, FLV, 3GP, MPEG/MPG, TS, WMV, and audio MP3, M4A, AAC, OGG/OGA, Opus, WAV, FLAC, WEBA. Sources: `<video>` and `<audio>` players, video thumbnails that carry a media file in a `data-*` attribute (for example Dribbble's `data-video-teaser-large`; the largest variant wins and it is only checked once the thumbnail scrolls into view), links to media files, and the page's own published file (`og:video`, `og:audio`, `twitter:player:stream`, or schema.org `VideoObject`/`AudioObject` `contentUrl`).

How a file is judged:

1. A player using `blob:` / MediaSource, `.m3u8` or `.mpd` gets the page's published file if there is one; otherwise it is not downloadable. Streams are never stitched together, and DRM players (`mediaKeys`) are always skipped.
2. Every candidate gets a `HEAD` (or a 1-byte ranged `GET`). Only a `video/*` or `audio/*` type from the list above, or `application/octet-stream` with a matching extension, counts as downloadable. 401/403/404/5xx get clear messages.
3. The download starts only on click, through `chrome.downloads.download()`. The file goes straight from the website to disk; nothing passes through the backend or JavaScript memory.

Safety: http/https only, localhost / private / link-local IP literals and `.local`-style hosts blocked, final redirect URL re-checked, filenames sanitized with the extension kept, duplicate clicks and already-running URLs rejected.

### Stream downloads (HLS / DASH) for allowlisted websites

Settings → **Stream downloads (HLS / DASH)** takes a list of websites typed in by the user. Only add websites whose videos you own or have permission to download. On those websites (and their subdomains) a streamed player that has no single file gets the same green icon, icon count and popup entry as a normal video:

1. The page script spots the `.m3u8` (HLS) or `.mpd` (DASH) manifest the player loaded (via the page's resource timing, no extra permission) once the site is in the list.
2. The background checks the tab's real URL against the list (a page can't claim to be allowlisted), reads the playlist, picks the best quality that has audio built in, and refuses encrypted (`#EXT-X-KEY` other than `NONE`), DRM and live streams. Byte-range playlists (`#EXT-X-BYTERANGE`, one big file split by ranges) are fetched with HTTP `Range` requests.
3. An offscreen document downloads the segments, 4 at a time with 3 retries each, in order, straight into the browser's private file storage (OPFS), so large videos never sit in memory. The finished file is handed to `chrome.downloads`, then the temporary copy is deleted.
4. TS streams save as `.ts`, fragmented MP4 as `.mp4`. When the best quality keeps audio in a separate fragmented-MP4 track, a small built-in muxer joins them into one `.mp4` (audio gets its own track id, segments are interleaved). Only separate-audio TS streams, which would need ffmpeg, still save video and audio as two files.

Extra stream options:

- **Stream quality** (Settings): best available, or up to 1080p / 720p / 480p / 360p. The highest quality at or below the limit is used; if nothing fits, the smallest one.
- **Audio only** (popup → Videos on this page): saves just the separate audio track as `.m4a` (or `.aac`). Shown only when the stream has a separate audio track; audio mixed into the video can't be pulled out without ffmpeg.
- **Save subtitles** (Settings, on by default): HLS `#EXT-X-MEDIA:TYPE=SUBTITLES` (the default language of the chosen quality) and DASH `text/vtt` tracks are saved as `Title.<language>.vtt` next to the video. Segmented WebVTT is joined into one file.
- Signed stream links often expire after a few hours, so a queued stream can fail at night with a 403. Failed items stay in the Tonight list with the reason and can be removed.
- **Tonight** (popup): queues a video for the night window set in Settings (default 1:00 AM to 9:00 AM, for cheaper night internet packages). A `chrome.alarms` alarm starts the queue at the window start; if the browser was closed then, the queue starts the next time the extension wakes up inside the window, otherwise it waits for the next night. The browser has to be open. Queued items show in the popup's Downloads tab and can be cancelled.

DASH manifests are read by a small built-in XML parser (service workers have no `DOMParser`). Supported: `SegmentTemplate` with `$Number$` (including `%05d` padding), `$Time$` and `SegmentTimeline`, `SegmentList` with byte ranges, and single-file `SegmentBase` representations, which are split into 8 MB range requests after a size check so the file is never held in memory or downloaded twice. Live (`type="dynamic"`), `ContentProtection` (encrypted/DRM) and multi-period manifests are refused. MP4 video plus separate MP4 audio is joined into one file like HLS; WebM tracks save as separate files.

#### Making your own website downloadable

If your player keeps the manifest inside page data (like Facebook does) instead of requesting a visible `.m3u8`/`.mpd`, tell the extension where the download is. Only websites in **Stream domains** are read; everywhere else these hints are ignored. The extension checks, in this order:

1. `data-download-url` on the `<video>` or any of its 5 nearest containers (a direct file, `.m3u8` or `.mpd`). It can be set or changed after the player starts; the extension notices.
2. `<link rel="alternate" type="application/dash+xml|application/x-mpegURL|video/mp4" href="...">` in the page.
3. `og:video` when it points to a `.m3u8` or `.mpd`.
4. The playlist the player was seen loading over the network.

```html
<div class="player" data-download-url="https://cdn.mysite.com/v/123/master.m3u8?token=SIGNED">
  <video src="blob:https://mysite.com/..."></video>
</div>

<link rel="alternate" type="application/dash+xml" href="https://cdn.mysite.com/v/123/manifest.mpd?sig=SIGNED">
```

Requirements on your side:

- The manifest URL path must end in `.m3u8` or `.mpd` (query strings for signatures are fine).
- No DRM or `#EXT-X-KEY` / `ContentProtection` encryption, and video-on-demand only (not live).
- Signed URLs must stay valid for the whole download: the manifest and every segment are fetched over several minutes. Cookies are sent, so session-based access works for logged-in users.
- No CORS setup is needed; the extension has its own site access once the downloader is enabled.

The Downloads tab shows stream jobs next to normal downloads, with Pause, Resume, Cancel, Retry and Remove. If the browser closes mid-download the job is marked failed and can be retried.

When a page has downloadable videos, the extension icon shows how many (1, 2, 3…) for that tab, and opening the popup jumps to a **Videos (N)** list with a Download button per video. The count updates as videos appear or disappear and clears when the tab navigates or closes.

Popup → **Downloads** tab shows title, format, size, progress and status, with Pause, Resume, Cancel, Retry, Open and Show in folder. Chrome keeps the real download state, so it survives service-worker restarts and browser restarts; interrupted downloads offer Resume when the server supports it, otherwise Retry.

Performance: Google results render first; cached accessibility results are applied straight away (`lookup`), only new domains go to the backend in batches (`check`). Video checks run on demand, at most 3 at a time, and are cached for 10 minutes.

## Website

`website/` is the project's public site (Vite, React, Tailwind): landing page, a live "Is a site blocked where you are?" checker that calls the same API, install steps for Chrome, Edge and Firefox, a section for website owners, FAQ, and a privacy policy page (`privacy.html`, usable for store listings). It reuses the extension's country names, status colours, evidence labels and Cloudflare country fallback from `extension/src/core`.

```bash
cd website && npm install
```

```bash
cd website && npm run build
```

### Video download route

The website's **Download video** page (`download.html`) takes any link and lists every quality the video offers (144p to 4K), with size and whether it has sound:

- `POST /api/v1/media/formats` `{ "url": "…" }` follows the link. A direct media file gives one format; an HLS master playlist or DASH manifest gives one format per quality plus "Audio only"; a normal web page is searched for its player source, `data-download-url`, `<link rel=alternate>`, `og:video`, schema.org `contentUrl` and `.m3u8`/`.mpd`/`.mp4` URLs in its scripts.
- Each format carries a signed token (HMAC with `MEDIA_SECRET`, valid 30 minutes) instead of the URL, so the download route can't be used to fetch arbitrary addresses.
- The lookup also returns a **preview**: the page's thumbnail (video `poster`, `og:image`, `twitter:image` or schema.org `thumbnailUrl`), served through `GET /api/v1/media/thumbnail?t=…` (JPEG, PNG, WebP, GIF or AVIF only, up to 5 MB, never SVG), and for direct files a small inline player through `GET /api/v1/media/preview?t=…` (same stream as the download, `inline`, with byte ranges for seeking, on its own small pool of slots). Streams without a page show a placeholder with the best quality.
- `GET /api/v1/media/download?t=…` streams the file with `Content-Disposition: attachment`. HLS and DASH segments are fetched 4 at a time with retries; fragmented MP4 video with separate sound is joined into one MP4 by the same muxer the extension uses; TS streams save as `.ts`; DASH single-file renditions are split by their `sidx` index when they need joining.
- Every request (link, redirect, playlist, segment) is checked against private and reserved addresses and pinned to the resolved IP. Downloads are limited by `MEDIA_MAX_MB` (default 4096), `MEDIA_MAX_CONCURRENT` (6) and `MEDIA_MAX_PER_CLIENT` (2); `MEDIA_DOWNLOADS=false` turns the route off. These two routes are not request-logged, so pasted links are not stored.
- Not supported, on purpose: YouTube, Facebook, Instagram, TikTok, X, Vimeo, Netflix and similar platforms that do not allow downloading (list in `extension/src/core/restricted-sites.ts`), adult tube sites, encrypted or DRM streams, and live streams.
- Downloads pass through the server, so they use its bandwidth. Set a lower `MEDIA_MAX_MB` or turn the route off on a small VPS.

The backend now builds with esbuild (`npm run build` → `dist/server.js`), because it shares the HLS, DASH and MP4 code in `extension/src/core` with the extension.

`npm run build` writes static files to `website/dist/` for any static host. Set `VITE_API_URL` (the backend, https in production) and optionally `VITE_REPO_URL` at build time; see `website/.env.example`. The backend only answers browsers from origins in `CORS_ORIGINS` (default `http://localhost:3180`, the local preview port), so add the website's address there in production.

## Project layout

```
backend/
  src/server.ts                 boot, migrations, pruning, shutdown
  src/app.ts                    Fastify app, rate limit, routes
  src/routes/                   accessibility.ts (POST /check), status.ts (GET /status)
  src/services/                 dns-checker, http-checker, blockpage, ooni-service,
                                pakistan-probe, classification-engine, accessibility-service
  src/database/                 repository, migrate, pool
  src/utils/                    domain + IP validation, TTL cache, limiter
  migrations/001_init.sql
  test/
extension/
  src/core/                     pure logic: types, domain parsing, filter rules, settings, formatting
  src/background/               service worker, API client, batching checker, media inspector, download manager
  src/content/                  result detector, badge + tooltip, filter, notice, video buttons and video-page script
  src/popup/ src/options/       React UI
  src/ui/                       shared components + hooks
  scripts/build.mjs             builds pages (Vite), scripts (esbuild), manifest and icons
  test/
docs/
  DEPLOYMENT.md                 Pakistan VPS + production guide
  OONI.md                       OONI integration notes
```

## Local development

Requirements: Node 20+.

```bash
cd backend && npm install && cp .env.example .env && npm run dev
```

```bash
cd extension && npm install && npm run build
```

`npm run build` uses `API_URL` (default `http://localhost:8787`). For production:

```bash
cd extension && API_URL=https://pk-probe.example.com npm run package
```

Only `https://` URLs are accepted, except localhost.

Running locally is fine for development, but checks then reflect **your** network, not Pakistan.

### Install the extension in Chrome

1. Build it (`npm run build` in `extension/`).
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and select `extension/dist`.
4. Search on google.com or google.com.pk.

### Edge and Firefox

- **Edge:** the Chrome build works as is. Load `extension/dist` from `edge://extensions` (Developer mode → Load unpacked), or upload `pk-access-filter.zip` from `npm run package` to Edge Add-ons.
- **Firefox (128+):** `npm run build:firefox` writes `extension/dist-firefox/`, and `npm run package:firefox` zips it. Load it from `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `dist-firefox/manifest.json`. Firefox uses an event page instead of a service worker and has no offscreen documents, so HLS/DASH stream downloads say they are not supported there; badges, the popup, right-click checks, failed-site pages, direct file downloads and night downloads work. In Firefox, also allow the API host in the add-on's permissions if it asks.

### Tests

```bash
cd backend && npm test
```

```bash
cd extension && npm test
```

Backend tests cover domain/IP validation, SSRF guards, redirect rules, block-page detection, every classification rule, OONI parsing/backoff, API validation, batching, dedupe and rate limiting. Extension tests cover domain extraction (including Google's opaque `/goto` links), filter rules, settings sanitising, cache policy and result detection (ads, featured snippets, sitelinks, duplicates).

## API

`POST /api/v1/check`

```json
{ "domains": ["example.com", "example.org"], "country": "auto" }
```

`country` is `auto` (or left out) to use the caller's IP, or a two-letter code. The response also has `country`, `countrySource` (`chosen`, `ip` or `default`) and `measuredBy` (`probe`, `peer` or `ooni`).

```json
{
  "results": [
    {
      "domain": "example.com",
      "status": "accessible",
      "confidence": 0.9,
      "country": "PK",
      "lastChecked": "2026-11-01T13:08:11.359Z",
      "evidence": ["dns_resolved", "control_dns_resolved", "https_connection_success", "https_status_200", "ooni_recent_ok"],
      "method": "DNS + HTTPS/HTTP probe from Pakistan, cross-checked with OONI",
      "network": { "isp": "PTCL", "asn": "AS17557", "city": "Karachi" },
      "ttlSeconds": 1200
    }
  ],
  "rejected": []
}
```

Max 20 domains per request. Invalid, private or reserved hosts come back in `rejected` and are never contacted.

`GET /api/v1/whereami?country=auto` returns `{ country, source, measuredBy }` for the caller. `GET /api/v1/status` returns probe network info, `probeCountries` and the caller's `viewer` country. `GET /api/v1/history?domain=…&country=PK` has data only for the probe country. `GET /health` returns `{ "ok": true }`.

## Security and privacy

- Only bare domains are accepted; no arbitrary URL fetching.
- All resolved IPs are checked against private, loopback, link-local, CGNAT, multicast and reserved ranges (IPv4 + IPv6, including IPv4-mapped). The connection is pinned to the validated IP, so DNS rebinding can't redirect it.
- Every redirect is re-validated (http/https only, ports 80/443, public hosts). Max 5 redirects, 64 KB body cap, per-request timeouts.
- Rate limiting per IP, 16 KB body limit, strict JSON schema.
- No secrets in the extension. Required permissions: `storage`, `activeTab`, `contextMenus`, `alarms` and the API host, none of which show an install warning. Everything else (`downloads`, `notifications`, `scripting`, site access, `webNavigation`) is optional and requested only when the matching setting is turned on.
- Badges, tooltip and notice are rendered with `textContent` inside closed Shadow DOM.
- To find the country, the server uses the request's IP address and does not store it; only when it can't tell does the browser ask Cloudflare's trace page, at most once a minute.
- Only domains are sent: search results, sites you check from the right-click menu and, if turned on, sites that fail to load. Never search queries, full URLs or browsing history. No accounts.

## Known limits

- Countries without a test server depend on OONI coverage; little-measured sites show Unknown there unless the own-connection check is on.
- One VPS = one ISP. Other Pakistani ISPs may block differently; OONI data per ASN partly covers this (see `docs/DEPLOYMENT.md` for adding more probes).
- Google changes its markup often. Detection relies on `#search a h3`, `[data-hveid]` and the displayed URL; if badges stop appearing, update `extension/src/content/result-detector.ts`.
- Block-page fingerprints live in `backend/src/services/blockpage.ts`; add new ones there.

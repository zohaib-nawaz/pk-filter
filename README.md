# PK Access Filter

A Chrome extension that marks each Google Search result as **Accessible**, **Blocked**, **Possibly blocked**, **Unknown** or **Server error** from Pakistan, and can hide results with confirmed blocking evidence.

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
{ "domains": ["example.com", "example.org"], "country": "PK" }
```

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

`GET /api/v1/status` returns probe network info. `GET /health` returns `{ "ok": true }`.

## Security and privacy

- Only bare domains are accepted; no arbitrary URL fetching.
- All resolved IPs are checked against private, loopback, link-local, CGNAT, multicast and reserved ranges (IPv4 + IPv6, including IPv4-mapped). The connection is pinned to the validated IP, so DNS rebinding can't redirect it.
- Every redirect is re-validated (http/https only, ports 80/443, public hosts). Max 5 redirects, 64 KB body cap, per-request timeouts.
- Rate limiting per IP, 16 KB body limit, strict JSON schema.
- No secrets in the extension. Permissions: `storage` plus the API host only.
- Badges, tooltip and notice are rendered with `textContent` inside closed Shadow DOM.
- Only result domains are sent, never search queries, full URLs or browsing history. No accounts.

## Known limits

- One VPS = one ISP. Other Pakistani ISPs may block differently; OONI data per ASN partly covers this (see `docs/DEPLOYMENT.md` for adding more probes).
- Google changes its markup often. Detection relies on `#search a h3`, `[data-hveid]` and the displayed URL; if badges stop appearing, update `extension/src/content/result-detector.ts`.
- Block-page fingerprints live in `backend/src/services/blockpage.ts`; add new ones there.

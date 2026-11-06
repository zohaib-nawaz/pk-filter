# OONI integration

[OONI](https://ooni.org) collects network measurements from volunteers, in most countries. We use its public API (https://api.ooni.io) as a second, independent source of evidence. Results are browsable on [OONI Explorer](https://explorer.ooni.org/).

## What we call

One request per host variant (`example.com` and `www.example.com`), made from `backend/src/services/ooni-service.ts`:

```
GET https://api.ooni.io/api/v1/aggregation
  ?probe_cc=DE
  &domain=example.com
  &test_name=web_connectivity
  &since=<today - 30 days>
  &until=<tomorrow>
  &axis_x=measurement_start_day
  &axis_y=probe_asn
```

Each row has `measurement_count`, `anomaly_count`, `confirmed_count`, `failure_count`, `ok_count`, the day and the probe ASN.

## How it is summarised

`summarizeOoni` turns the rows into:

- `total`: last 30 days
- `recent`: last 7 days (the only window used for decisions)
- `networks`: per-ASN counts for the last 7 days
- `lastMeasuredDay`

Meaning of the counts:

- `confirmed`: OONI matched a known block-page fingerprint. Strong evidence.
- `anomaly`: something differed from OONI's uncensored control. Can be blocking, but also CDN differences, outages or flaky probes. Weak on its own.

## How it affects classification

- Recent `confirmed` > 0 **and** our live probe failed → **Blocked**.
- Live interference (DNS manipulation or HTTPS reset) **and** ≥70% recent anomalies over ≥5 measurements → **Blocked**.
- ≥50% recent anomalies over ≥3 measurements with no live success → **Possibly blocked**.
- Our live probe succeeded → **Accessible**, even if OONI has older confirmed blocking (confidence lowered to 0.7). History is never treated as proof of current blocking.
- No OONI data → only live evidence is used.

## Rate limits and failures

- At most 4 domains are queried concurrently.
- Successful summaries are cached 12 hours; failures 5 minutes.
- On any error (including HTTP 429) the client pauses with exponential backoff (5 s doubling, max 30 min) and the check continues without OONI (evidence `ooni_unavailable`).
- Set `OONI_ENABLED=false` to turn it off.

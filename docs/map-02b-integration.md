# MAP-02B public map integration

The indoor map reads only `GET /api/schedule?course=1|2` and
`GET /api/status?course=1|2`. Existing response bodies are unchanged. Groups come
from the full schedule response. No new route, parsing, scraping, storage,
authentication, refresh, broker or publication behavior is introduced.

Set `SCHEDULE_MAP_ORIGINS` to a comma-separated list of **exact origins** without
paths or trailing slashes. Empty (the default) allows no cross-origin requests.
Wildcard, opaque `null`, credentials and malformed entries are ignored. The map
uses simple GET with `credentials: omit`; supported OPTIONS permits GET only and
rejects custom headers. Responses vary by Origin, including denied origins and
errors. Denied-origin GET still behaves as the existing public API, but browsers
cannot read its body. Admin and other public routes do not gain CORS.

Local example (two terminals; use an isolated cache copied from accepted data):

```powershell
cd C:\Users\user\Documents\automated-student-schedule-system
$env:SCHEDULE_MAP_ORIGINS='http://127.0.0.1:8765'
$env:SCHEDULE_DISABLE_SCHEDULER='1'
$env:SCHEDULE_DATA_DIR='C:\path\to\isolated-accepted-cache'
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Serve the map on port 8765 and select local API `http://127.0.0.1:3000` in its
source controls. An empty cache can invoke the producer's existing cold bootstrap;
use accepted cached schedules for an offline/replay test. Never call admin refresh
for map refresh. Refresh repeats the two public reads.

Consistency: the consumer requires matching course, academic year, semester,
source kind, PDF URL/hash, parser version, downloaded_at and parsed_at across the
two responses. A revision switch rejects the candidate, preserving its previous
validated dataset. `last_success_at` is a separate source-state diagnostic, not
the revision identity. Source transport and broker snapshot ID are retained from
schedule metadata. Calendar anchor/timezone come from status and stay explicitly
configured/unverified; no official validity dates are inferred.

Production gate: select and authorize the actual map HTTP(S) origin, deploy these
changes separately, configure its exact origin in `SCHEDULE_MAP_ORIGINS`, then
verify both course responses in a real browser. This document does not authorize
deployment or assume a map hostname. Local and replay tests do not prove production
CORS. Existing production GET clients remain usable with an empty allowlist.

Rollback: restore the previous deployment or revert only `src/lib/public-cors.ts`,
the two route wrappers, their tests and configuration docs; remove
`SCHEDULE_MAP_ORIGINS`. No data migration or deletion is required. Keep existing
accepted schedules, source states and broker data.

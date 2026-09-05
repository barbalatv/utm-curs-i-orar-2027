## API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | liveness (`ok`, `has_schedule`) |
| `GET /api/status` | schedule stats + updater state (last check, last error, result) |
| `GET /api/groups` | groups discovered in the PDF with lesson counts |
| `GET /api/schedule?group=SI-261&day=Luni&teacher=&subject=&room=&q=` | filtered lessons |
| `GET /api/schedule/{group}` | one group, grouped `by_day` |
| `GET /api/schedule/{group}/today` | today's lessons (Europe/Chisinau) |
| `GET /api/source` | provenance: current PDF URL, hash, ETag, discovery kind |
| `POST /api/admin/refresh[?force=1]` | maintenance re-check; `Authorization: Bearer $SCHEDULE_ADMIN_TOKEN`; no URL parameter (no SSRF) |

## Testing the parser manually

```bash
npm run parser -- parse tests/fixtures/anul_i_semestrul_ii-1.pdf --json out.json   # schedule.json + stats
npm run parser -- stats some-other.pdf                                             # only statistics
npm run parser -- debug some-other.pdf --output debug/                             # debug artefacts
npm test                                                                           # vitest suite
```

`stats` prints groups, lessons, lessons per group, per type, merged cells, uncertain entries and
the validation verdict. Exit code 1 if validation fails. Use it to check any new PDF before it is
published.

### Debugging PDF geometry

`debug/` contains:

- `detected_groups.json` – group columns with X bounds
- `detected_days.json` – day blocks and time-slot rows with Y bounds
- `cells.json` – reconstructed cells (lines, groups, slots, background colour)
- `orphans.json` – text inside the table that mapped to no group/slot (should be empty)
- `lessons.json` – final lessons
- `page_debug.svg` – overlay: blue = group column boundaries + labels, orange dashed = slot rows,
  coloured blocks = days, green boxes = lessons, purple = merged (multi-group) lessons,
  red = uncertain, orange dashed = orphans. Open it in a browser; hover a box for details.

## schedule.json

```jsonc
{
  "metadata": {
    "academic_year": "2026/2027", "semester": "Semestrul I", "course_year": 1,
    "source_page_url": "https://fcim.utm.md/procesul-de-studii/orar/",
    "source_pdf_url": "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-5.pdf",
    "source_pdf_hash": "sha256…", "source_kind": "live | wayback | seed | manual",
    "downloaded_at": "…", "parsed_at": "…", "parser_version": "1.1.0",
    "etag": null, "last_modified": null, "pdf_title": "ANUL UNIVERSITAR 2026/2027, ANUL I, SEMESTRUL I"
  },
  "groups": [{ "name": "SI-261", "program": "SI", "x0": 52.6, "x1": 79.8 }],
  "days": ["Luni", "Marți", "Miercuri", "Joi", "Vineri"],
  "time_slots": [{ "index": 0, "start_time": "08:00", "end_time": "09:30", "raw": "8.00-9.30" }],
  "lessons": [{
    "id": "3f2a…", "day": "Luni", "slot_index": 2, "slot_span": 1,
    "start_time": "11:30", "end_time": "13:00",
    "groups": ["TI-251", "TI-252", "TI-253"],
    "subject": "Matematica Discretă și Probabilitatea Statistică", "teacher": "Leahu A.", "room": "6-2",
    "lesson_type": "lecture", "subgroup": null, "week_parity": "both",
    "notes": [], "raw_text": "c. Matematica Discretă … | Leahu A. | 6-2",
    "geometry": { "page": 1, "x0": 43.8, "y0": 195.7, "x1": 207.8, "y1": 211.6 },
    "confidence": 0.95, "uncertain": false
  }],
  "warnings": []
}
```

`lesson_type` ∈ lecture · lab · seminar · practice · physical_education · language · project ·
unknown. `week_parity` ∈ odd · even · both · unknown.

## Environment variables

See `.env.example`. Key ones: `SCHEDULE_PAGE_URL`, `SCHEDULE_REFRESH_MINUTES` (30),
`SCHEDULE_COURSE_YEAR` (1), `SCHEDULE_ODD_WEEK_ANCHOR` (Monday of an odd week – set once per
semester), `SCHEDULE_ALLOWED_HOSTS`, `SCHEDULE_WORDPRESS_FALLBACK`,
`SCHEDULE_WAYBACK_FALLBACK`,
`SCHEDULE_HTTP_TIMEOUT_MS`, `SCHEDULE_MAX_REDIRECTS`, `SCHEDULE_MAX_PDF_MB`, `SCHEDULE_DATA_DIR`,
`SCHEDULE_SEED_PDF`, `SCHEDULE_SEED_PDF_MIRROR_URL`,
`DATABASE_URL` (optional), `SCHEDULE_ADMIN_TOKEN`, `SCHEDULE_DISABLE_SCHEDULER`, `LOG_LEVEL`.

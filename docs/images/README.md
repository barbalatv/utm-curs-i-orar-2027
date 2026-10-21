# Screenshot provenance

[Project overview](../../README.md) · [Engineering case study](../portfolio.md)

Both images capture the actual public application at
<https://utm-curs-i-orar-2027.onrender.com/> on **22 October 2026, approximately 02:14
Europe/Chisinau** (21 October, 23:14 UTC). Capture completed at
`2026-10-21T23:14:44.358Z`. The page returned HTTP 200.

| Image | Viewport / image pixels | File size | Selected view |
| --- | --- | --- | --- |
| [Desktop](timetable-desktop.webp) | 1440 × 900 | 28,624 bytes | Anul I, FAF-261, day view, Friday selected |
| [Mobile](timetable-mobile.webp) | 390 × 844 | 22,230 bytes | Same group and day; responsive layout and bottom view navigation |

Captured with headless Playwright Chromium, a fresh browser context, device scale 1,
Romanian locale, and the Europe/Chisinau timezone. Normal UI controls selected the
group and Friday; the browser clock was not overridden. Navigation settled before
capture. No API interception, fixture injection, DOM/style changes, or timetable edits
were used. The files contain the page viewport without browser chrome. They were
converted from PNG to lossless WebP; decoded RGB pixels were verified identical.

At capture, the UI displayed **09.10.2026 04:08** as its update time and
**22.10.2026 01:58** as its last check. It linked to the
[official Anul I PDF](https://fcim.utm.md/wp-content/uploads/sites/24/2026/10/anul_i_semestrul_i-4.pdf)
and [FCIM timetable page](https://fcim.utm.md/orar-sectia-zi-2/).
The displayed academic context was 2026/2027, semester I, with 41 groups and 454 lessons.
Those are observations of accepted application data, not independent confirmation
that it matches the latest official publication. The subdued styling of other-week
lessons in the application is intentional, not screenshot editing.

Source documentation was checked against repository baseline
`b7a2e9925080a6e6f04875f78f637b0bd4ce4f0a`. The public deployment was **not linked to
that SHA**, and optional infrastructure was not inspected at service/account level.
The screenshots therefore demonstrate the observed public UI, not deployment identity,
university endorsement, guaranteed freshness, attendance, or uptime.

Visual inspection confirmed readable lesson cards, the selected course/group/day,
mobile navigation, and desktop source/status details. Document scroll width equalled
viewport width at both sizes (1440 and 390 pixels); no horizontal overflow was observed
in these selected views. This is a viewport check, not a complete device/browser audit.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";
import { discoverPdf } from "@/lib/source/discovery";
import { isNewerPdfPublication } from "@/lib/source/revision";
import { checkForUpdates, selectCandidateFile } from "@/lib/services/updater";
import { getCurrentSchedule, resetStorageCache } from "@/lib/storage";
import type { SnapshotManifest, AcceptedPointer } from "@/lib/models";
import worker from "../worker/src/index";
import { CANONICAL_PAGE_API_URL, CANONICAL_PAGE_ID, LEGACY_PAGE_API_URL, LEGACY_PAGE_ID } from "../worker-shared/fcim-policy";
import { extractOfficialPdfUrls } from "../worker-shared/pdf-inventory";
import { runPublish } from "../tools/md-publisher/src/publish";
import { StateStore } from "../tools/md-publisher/src/state";
import { sha256Hex } from "../tools/md-publisher/src/hash";
import type { PublisherConfig } from "../tools/md-publisher/src/types";
import { createTestTransport, FAKE_BROKER_ORIGIN } from "./helpers/md-publisher-transport";
import { createHarness, TEST_PUBLISHER_TOKEN, type WorkerHarness } from "./helpers/worker-doubles";
import { openPublication, pagePayload, pdfBody, publishThroughApi } from "./helpers/md-publication";

const NOW = new Date("2026-10-09T08:00:00Z");
const HTML = await readFile(path.join(__dirname, "fixtures/orar-sectia-zi-2-2026-10-09.html"), "utf8");
const PAGE = JSON.stringify([{ id: CANONICAL_PAGE_ID, modified_gmt: "2026-10-06T08:54:47", content: { rendered: HTML } }]);
const URLS = extractOfficialPdfUrls(HTML);
const OLD_URL = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/orar_ses_toamna_fr-1-10.pdf";

describe("full-time source migration", () => {
  let dir: string;
  let broker: WorkerHarness;
  let publisher: PublisherConfig;
  const savedConfig = { dataDir: config.dataDir, brokerUrl: config.brokerUrl, brokerSecret: config.brokerSecret };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    dir = await mkdtemp(path.join(tmpdir(), "fcim-source-migration-"));
    broker = createHarness();
    publisher = { brokerUrl: FAKE_BROKER_ORIGIN, token: TEST_PUBLISHER_TOKEN, stateDir: path.join(dir, "publisher"), timeoutMs: 30000, version: "test", logonModel: null };
    Object.assign(config, { dataDir: path.join(dir, "render"), brokerUrl: FAKE_BROKER_ORIGIN, brokerSecret: broker.env.SCHEDULE_BROKER_SECRET });
    resetStorageCache();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.assign(config, savedConfig);
    resetStorageCache();
    await rm(dir, { recursive: true, force: true });
  });

  // Construct a stored legacy snapshot, not a new publication through the forbidden endpoint.
  async function legacyBaseline(observedEtag?: string, modifiedGmt = "2026-10-07T20:23:02") {
    const oldPage = pagePayload({ urls: [OLD_URL], modifiedGmt });
    const result = await publishThroughApi(broker, { page: oldPage, observedEtag });
    const key = `snapshots/${result.snapshotId}/manifest.json`;
    const manifest = broker.bucket.json<SnapshotManifest>(key)!;
    manifest.source.page_api_url = LEGACY_PAGE_API_URL;
    manifest.source.page_id = LEGACY_PAGE_ID;
    broker.bucket.seed(key, JSON.stringify(manifest));
    const archived = JSON.parse(oldPage);
    archived[0].id = LEGACY_PAGE_ID;
    broker.bucket.seed(`snapshots/${result.snapshotId}/page-api.json`, JSON.stringify(archived));
    const pointer = broker.bucket.json<Record<string, unknown>>("current.json")!;
    pointer.page_id = LEGACY_PAGE_ID;
    broker.bucket.seed("current.json", JSON.stringify(pointer));
    return { result, oldPage: JSON.stringify(archived) };
  }

  function serving(page = PAGE, bodies: Record<string, Uint8Array> = {}) {
    return createTestTransport(broker, {
      page: () => ({ status: 200, body: page, headers: { etag: '"new-page"' } }),
      pdf: (url, headers) => !URLS.includes(url) ? { status: 404 } : headers["If-None-Match"] === '"pdf"'
        ? { status: 304 } : { status: 200, body: bodies[url] ?? pdfBody(url), headers: { "content-type": "application/pdf", etag: '"pdf"' } },
    });
  }

  it.each([1, 2, 3, 4])("identifies course %i, academic year and explicit semester from exact upstream HTML", (course) => {
    const discovered = discoverPdf(HTML, course, NOW);
    expect(discovered.pdf_url).toBe(URLS[course - 1]);
    expect(discovered.academic_year).toBe("2026/2027");
    expect(discovered.semester).toBe(["Semestrul I", "Semestrul III", "Semestrul V", "Semestrul VII"][course - 1]);
    expect(discovered.semester_source).toBe("explicit");
  });

  it("rejects wrong course, semester, year, origin, reduced attendance and ambiguous data", () => {
    for (const html of [
      HTML.replace(URLS[0], URLS[1]),
      HTML.replace('"y":"I","sem":"I"', '"y":"I","sem":"II"'),
      HTML.replace("2026/2027", "2025/2026"),
      HTML.replace(URLS[0], URLS[0].replace("fcim.utm.md", "evil.example")),
      HTML.replace("învățământ cu frecvență", "învățământ cu frecvență redusă"),
      HTML + HTML,
    ]) expect(() => discoverPdf(html, 1, NOW)).toThrow();
    expect(() => discoverPdf(HTML, 1, new Date("2027-03-01"))).toThrow(/current semester/);
  });

  it("keeps legitimate historical layouts discoverable", async () => {
    const html = await readFile(path.join(__dirname, "fixtures/orar-page-autumn-2026.html"), "utf8");
    for (const course of [1, 2]) expect(discoverPdf(html, course, NOW).academic_year).toBe("2026/2027");
  });

  it.each([undefined, '"old-pdf"'])("publishes migration with an orphaned 404, with validator %s", async (etag) => {
    const { result: before } = await legacyBaseline(etag);
    const archivedKeys = broker.bucket.keys().filter((key) => key.startsWith(`snapshots/${before.snapshotId}/`));
    const { transport, log } = serving();
    const result = await runPublish(publisher, transport);
    expect(result.outcome).toBe("published");
    expect(log.fcim.some((call) => call.url === OLD_URL)).toBe(false);
    expect(log.fcim[0].headers["If-None-Match"]).toBeUndefined();
    const manifest = broker.bucket.json<SnapshotManifest>(`snapshots/${result.snapshot_id}/manifest.json`)!;
    expect(manifest.previous_snapshot_id).toBe(before.snapshotId);
    expect(manifest.source).toMatchObject({ page_id: CANONICAL_PAGE_ID, page_api_url: CANONICAL_PAGE_API_URL, page_modified_gmt: "2026-10-06T08:54:47" });
    expect(manifest.files.map((file) => file.source_url)).toEqual(URLS);
    expect(archivedKeys.every((key) => broker.bucket.keys().includes(key))).toBe(true);
    const state = new StateStore(publisher.stateDir).readLastRun()!;
    expect(state.broker_snapshot_id).toBe(result.snapshot_id);
    expect(state.page_api_url).toBe(CANONICAL_PAGE_API_URL);
    expect((await runPublish(publisher, serving().transport)).outcome).toBe("unchanged");
  });

  it.each([[false, undefined], [true, undefined], [false, '"old"'], [true, '"old"']] as const)("fails on a missing retained PDF (changed=%s, validator=%s)", async (changed, etag) => {
    const original = pagePayload({ urls: [OLD_URL], modifiedGmt: "2026-10-07T20:23:02" });
    await publishThroughApi(broker, { page: original, observedEtag: etag });
    const page = changed ? original.replace("<p>Orar</p>", "<p>Orar changed</p>") : original;
    const before = broker.bucket.bytes("current.json");
    const result = await runPublish(publisher, serving(page).transport);
    expect(result.outcome).toBe("error");
    expect(result.error).toMatch(/404/);
    expect(broker.bucket.bytes("current.json")).toEqual(before);
  });

  it("migrates the observed September 26 baseline even with an anchored old-endpoint validator cache", async () => {
    const { result } = await legacyBaseline('"old"', "2026-09-26T08:29:31");
    const state = new StateStore(publisher.stateDir);
    state.writeLastRun({
      schema_version: 2, broker_snapshot_id: result.snapshotId, page_api_url: LEGACY_PAGE_API_URL,
      page_etag: '"legacy-page"', page_last_modified: "Sat, 26 Sep 2026 08:29:31 GMT",
      page_api_sha256: "0".repeat(64), page_modified_gmt: "2026-09-26T08:29:31",
      pdfs: [{ source_url: OLD_URL, sha256: "0".repeat(64), etag: '"old"', last_modified: null }],
      outcome: "published", completed_at: "2026-09-26T08:39:39.805Z",
    });
    const { transport, log } = serving();
    const published = await runPublish(publisher, transport);
    expect(published.outcome).toBe("published");
    expect(published.baseline_source).toBe("broker_snapshot");
    expect(log.fcim[0].headers["If-None-Match"]).toBeUndefined();
    expect(log.fcim[0].headers["If-Modified-Since"]).toBeUndefined();
  });

  it.each(["empty", "malformed", "multiple", "wrong-id"])("fails before orphan retirement on invalid changed inventory: %s", async (kind) => {
    await legacyBaseline();
    const before = broker.bucket.bytes("current.json");
    const payload = JSON.parse(PAGE);
    if (kind === "empty") payload[0].content.rendered = "<p>no timetable</p>";
    if (kind === "wrong-id") payload[0].id = 1739;
    if (kind === "multiple") payload.push(payload[0]);
    const result = await runPublish(publisher, serving(kind === "malformed" ? "{broken" : JSON.stringify(payload)).transport);
    expect(result.outcome).toBe("error");
    expect(broker.bucket.bytes("current.json")).toEqual(before);
  });

  it("migrates a legacy four-field pointer using immutable manifest identity", async () => {
    await legacyBaseline();
    const pointer = broker.bucket.json<Record<string, unknown>>("current.json")!;
    const legacy = { schema_version: 1, snapshot_id: pointer.snapshot_id, updated_at: pointer.updated_at, manifest_r2_key: pointer.manifest_r2_key };
    broker.bucket.seed("current.json", JSON.stringify(legacy));
    expect((await runPublish(publisher, serving().transport)).outcome).toBe("published");
  });

  it.each(["wrong-id", "missing-id", "missing-time", "before-floor", "future", "wrong-baseline"])("rejects unsafe migration: %s", async (kind) => {
    const { result } = await legacyBaseline();
    const payload = JSON.parse(PAGE);
    if (kind === "wrong-id") payload[0].id = 1739;
    if (kind === "missing-id") delete payload[0].id;
    if (kind === "missing-time") delete payload[0].modified_gmt;
    if (kind === "before-floor") payload[0].modified_gmt = "2026-10-06T08:54:46";
    if (kind === "future") payload[0].modified_gmt = "2026-10-12T08:00:00";
    if (kind === "wrong-baseline") {
      const key = `snapshots/${result.snapshotId}/manifest.json`;
      const manifest = broker.bucket.json<SnapshotManifest>(key)!;
      manifest.source.page_id = 999;
      broker.bucket.seed(key, JSON.stringify(manifest));
    }
    const before = broker.bucket.bytes("current.json");
    expect((await openPublication(broker, JSON.stringify(payload))).status).toBeGreaterThanOrEqual(400);
    expect(broker.bucket.bytes("current.json")).toEqual(before);
  });

  it("preserves the same-page timestamp guard and refuses reverse migration", async () => {
    await legacyBaseline();
    expect((await runPublish(publisher, serving().transport)).outcome).toBe("published");
    expect((await openPublication(broker, PAGE.replace("2026-10-06T08:54:47", "2026-10-06T08:54:46"))).status).toBe(409);
    expect((await openPublication(broker, PAGE.replace('"id":28642', '"id":1739'))).status).toBe(400);
  });

  it("does not advance current or accepted state when a new PDF is missing", async () => {
    await legacyBaseline();
    broker.bucket.seed("accepted/course-1.json", '{"existing":"course-1"}');
    broker.bucket.seed("accepted/course-2.json", '{"existing":"course-2"}');
    const before = broker.bucket.bytes("current.json");
    const acceptedBefore = [1, 2].map((course) => broker.bucket.bytes(`accepted/course-${course}.json`));
    const { transport } = createTestTransport(broker, { page: () => ({ status: 200, body: PAGE }), pdf: () => ({ status: 404 }) });
    expect((await runPublish(publisher, transport)).outcome).toBe("error");
    expect(broker.bucket.bytes("current.json")).toEqual(before);
    for (const course of [1, 2]) expect(broker.bucket.bytes(`accepted/course-${course}.json`)).toEqual(acceptedBefore[course - 1]);
  });

  it("orders publication months before suffixes in both discovery and manifest selection", async () => {
    const older = "https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/anul_i_semestrul_i-18.pdf";
    const newer = URLS[0];
    expect(isNewerPdfPublication(newer, older)).toBe(true);
    expect(isNewerPdfPublication(older, newer)).toBe(false);
    const html = `<section><h2>Ciclul I, Licență - învățământ cu frecvență</h2><table><tr><td>Orar semestrul de toamna 2026/2027</td><td><a href="${older}">Anul I</a><a href="${newer}">Anul I</a></td></tr></table></section>`;
    expect(discoverPdf(html, 1, NOW).pdf_url).toBe(newer);
    const published = await publishThroughApi(broker, { page: pagePayload({ urls: [older, newer] }) });
    const manifest = broker.bucket.json<SnapshotManifest>(`snapshots/${published.snapshotId}/manifest.json`)!;
    expect(selectCandidateFile(manifest, 1)?.source_url).toBe(newer);
    manifest.files.reverse();
    expect(selectCandidateFile(manifest, 1)?.source_url).toBe(newer);
    expect(isNewerPdfPublication(URLS[1], older)).toBe(false);
  });

  it("publishes a snapshot then updates durable and local accepted state independently for both courses", async () => {
    await legacyBaseline();
    // Replay: genuine historical PDF fixtures under the new inventory URLs; no live network.
    const bodies = {
      [URLS[0]]: new Uint8Array(await readFile(path.join(__dirname, "../data/seed/anul_i_semestrul_i-18.pdf"))),
      [URLS[1]]: new Uint8Array(await readFile(path.join(__dirname, "../data/seed/anul_ii_semestrul_iii-11.pdf"))),
    };
    const publication = await runPublish(publisher, serving(PAGE, bodies).transport);
    expect(publication.outcome).toBe("published");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith(FAKE_BROKER_ORIGIN)) throw new Error(`Unexpected outbound request: ${url}`);
      return worker.fetch(input instanceof Request && !init ? input : new Request(url, init), broker.env, broker.ctx);
    }));
    for (const course of [1, 2]) {
      const result = await checkForUpdates(course);
      expect(result.outcome, result.message).toBe("updated");
      const local = await getCurrentSchedule(course);
      expect(local?.metadata.course_year).toBe(course);
      expect(local?.metadata.source_pdf_url).toBe(URLS[course - 1]);
      expect(local?.metadata.source_snapshot_id).toBe(publication.snapshot_id);
      const accepted = broker.bucket.json<AcceptedPointer>(`accepted/course-${course}.json`)!;
      expect(accepted.source_snapshot_id).toBe(publication.snapshot_id);
      expect(accepted.source_pdf_hash).toBe(local?.metadata.source_pdf_hash);
    }
    const course1 = broker.bucket.bytes("accepted/course-1.json");
    expect((await checkForUpdates(2)).outcome).toBe("unchanged");
    expect(broker.bucket.bytes("accepted/course-1.json")).toEqual(course1);
  });

  it("extracts embedded PDFs even when unrelated official PDF anchors are present (FIX-01)", () => {
    const extraAnchor = '<p><a href="https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/ghid_student.pdf">Ghid</a></p>';
    const mixedHtml = extraAnchor + "\n" + HTML;
    const extracted = extractOfficialPdfUrls(mixedHtml);
    expect(extracted).toContain("https://fcim.utm.md/wp-content/uploads/sites/24/2026/09/ghid_student.pdf");
    for (const url of URLS) {
      expect(extracted).toContain(url);
    }
    expect(extracted).toHaveLength(5);
  });

  it("extracts embedded metadata with multiline formatting for both supported course years (FIX-02)", () => {
    const multilineHtml = HTML.replace(
      /const\s+D\s*=\s*\{/,
      'const D = {\n  \n  ',
    );
    for (const course of [1, 2]) {
      const discovered = discoverPdf(multilineHtml, course, NOW);
      expect(discovered.pdf_url).toBe(URLS[course - 1]);
      expect(discovered.academic_year).toBe("2026/2027");
      expect(discovered.semester).toBe(course === 1 ? "Semestrul I" : "Semestrul III");
    }
  });

  it("strictly rejects malformed JSON or duplicate definitions of const D (FIX-02)", () => {
    const malformedD = HTML.replace('const D={"years"', 'const D={"years": broken,');
    expect(() => discoverPdf(malformedD, 1, NOW)).toThrow(/Invalid or ambiguous/);

    const duplicateD = HTML.replace('const D={', 'const D={}; const D={');
    expect(() => discoverPdf(duplicateD, 1, NOW)).toThrow(/Invalid or ambiguous/);
  });

  it("safely invalidates a genuine legacy resumable operation and discovers page 28642 fresh (FIX-03)", async () => {
    await legacyBaseline();
    const state = new StateStore(publisher.stateDir);
    const legacyPageBytes = new TextEncoder().encode(
      pagePayload({ urls: [OLD_URL], pageId: LEGACY_PAGE_ID, modifiedGmt: "2026-09-26T08:29:31" }),
    );
    state.startOperation(
      {
        schema_version: 1,
        operation_id: "legacy-interrupted-op",
        page_api_sha256: sha256Hex(legacyPageBytes),
        snapshot_id: null,
        started_at: "2026-09-26T08:30:00.000Z",
      },
      legacyPageBytes,
    );
    expect(state.readResumableOperation()).not.toBeNull();

    const { transport } = serving();
    const result = await runPublish(publisher, transport);

    expect(result.outcome).toBe("published");
    expect(result.operation_id).not.toBe("legacy-interrupted-op");
    const manifest = broker.bucket.json<SnapshotManifest>(`snapshots/${result.snapshot_id}/manifest.json`)!;
    expect(manifest.source.page_id).toBe(CANONICAL_PAGE_ID);
    expect(manifest.source.page_api_url).toBe(CANONICAL_PAGE_API_URL);

    expect(state.readResumableOperation()).toBeNull();
    const lastRun = state.readLastRun()!;
    expect(lastRun.broker_snapshot_id).toBe(result.snapshot_id);
    expect(lastRun.page_api_url).toBe(CANONICAL_PAGE_API_URL);
  });

  it("fails closed and preserves invalid canonical-source operations without silent replacement (FIX-03)", async () => {
    await legacyBaseline();
    const state = new StateStore(publisher.stateDir);
    const unknownPageBytes = new TextEncoder().encode(
      JSON.stringify([{ id: 999, modified_gmt: "2026-10-06T08:54:47", content: { rendered: HTML } }]),
    );
    state.startOperation(
      {
        schema_version: 1,
        operation_id: "unknown-id-op",
        page_api_sha256: sha256Hex(unknownPageBytes),
        snapshot_id: null,
        started_at: NOW.toISOString(),
      },
      unknownPageBytes,
    );
    const beforeBroker = broker.bucket.bytes("current.json");

    const { transport } = serving();
    const result = await runPublish(publisher, transport);

    expect(result.outcome).toBe("error");
    expect(result.error).toMatch(/unknown page identity 999/);
    expect(state.readResumableOperation()).not.toBeNull();
    expect(broker.bucket.bytes("current.json")).toEqual(beforeBroker);
  });

  it("trims editorial whitespace around embedded PDF URLs consistently across inventory and discovery (FIX-04)", () => {
    const whitespaceHtml = HTML.replace(URLS[0], `  ${URLS[0]}  `);
    const extracted = extractOfficialPdfUrls(whitespaceHtml);
    expect(extracted).toContain(URLS[0]);

    const discovered = discoverPdf(whitespaceHtml, 1, NOW);
    expect(discovered.pdf_url).toBe(URLS[0]);
  });
});

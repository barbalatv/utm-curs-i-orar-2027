/**
 * Auto-update loop:
 *   page → discover PDF URL → conditional GET → sha256 → parse → validate → atomic replace.
 * Any failure keeps the previous known-good schedule. A bundled real FCIM PDF
 * is used only when there is no cache at all and the network is unavailable.
 */
import { readFile } from "node:fs/promises";
import { config } from "@/lib/config";
import { errorMessage, getLogger } from "@/lib/logger";
import type { Schedule, SourceState } from "@/lib/models";
import { parsePdf, sha256, type Provenance } from "@/lib/parser";
import { validateSchedule } from "@/lib/parser/validator";
import { discoverPdf, type DiscoveredPdf } from "@/lib/source/discovery";
import { fetchPdf, fetchSchedulePage, fetchWordPressSchedulePage, SourceFetchError, waybackUrl } from "@/lib/source/downloader";
import { getCurrentSchedule, getSourceState, replaceCurrentSchedule, saveSourceState } from "@/lib/storage";

const log = getLogger("updater");

export type CheckOutcome = SourceState["last_result"];

export interface CheckResult {
  outcome: CheckOutcome;
  message: string;
  pdf_url?: string;
  lessons?: number;
}

let inFlight: Promise<CheckResult> | null = null;

/** Run a check; concurrent callers share the same run (mutex). */
export function checkForUpdates(options: { force?: boolean } = {}): Promise<CheckResult> {
  if (!inFlight) {
    inFlight = runCheck(options).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

interface Discovery {
  pdf: DiscoveredPdf;
  kind: "live" | "wayback";
}

async function discoverCurrentPdf(): Promise<Discovery> {
  const failures: string[] = [];
  try {
    const html = await fetchSchedulePage(config.schedulePageUrl);
    return { pdf: discoverPdf(html), kind: "live" };
  } catch (liveError) {
    failures.push(errorMessage(liveError));
    log.warn("live schedule page unavailable", { error: errorMessage(liveError) });
  }

  if (config.wordpressFallbackEnabled) {
    try {
      const html = await fetchWordPressSchedulePage(config.wordpressApiUrl);
      return { pdf: discoverPdf(html), kind: "live" };
    } catch (wordpressError) {
      failures.push(`WordPress API: ${errorMessage(wordpressError)}`);
      log.warn("official WordPress API unavailable", { error: errorMessage(wordpressError) });
    }
  }

  if (!config.waybackFallbackEnabled) throw new Error(failures.join("; "));
  log.warn("official schedule sources unavailable, trying archive mirror");
  try {
    const html = await fetchSchedulePage(waybackUrl(config.schedulePageUrl), [config.waybackHost]);
    return { pdf: discoverPdf(html), kind: "wayback" };
  } catch (archiveError) {
    failures.push(`archive mirror: ${errorMessage(archiveError)}`);
    throw new Error(failures.join("; "));
  }
}

async function runCheck(options: { force?: boolean }): Promise<CheckResult> {
  const startedAt = new Date().toISOString();
  const state = await getSourceState();
  const current = await getCurrentSchedule();

  try {
    const discovery = await discoverCurrentPdf();
    const { pdf, kind } = discovery;
    const sameUrl = state.current_pdf_url === pdf.pdf_url && current !== null;
    const conditional = sameUrl && !options.force ? { etag: state.etag, lastModified: state.last_modified } : {};

    const downloadUrl = kind === "wayback" ? waybackUrl(pdf.pdf_url) : pdf.pdf_url;
    const extraHosts = kind === "wayback" ? [config.waybackHost] : [];
    const resource = await fetchPdf(downloadUrl, conditional, extraHosts);

    if (resource.notModified) {
      await saveSourceState({ last_check_at: startedAt, last_result: "unchanged", last_error: null, parity_note: pdf.parity_note });
      return { outcome: "unchanged", message: "PDF not modified (304)", pdf_url: pdf.pdf_url };
    }

    const hash = sha256(resource.bytes);
    if (!options.force && current && hash === current.metadata.source_pdf_hash) {
      await saveSourceState({
        last_check_at: startedAt,
        last_result: "unchanged",
        last_error: null,
        current_pdf_url: pdf.pdf_url,
        current_pdf_hash: hash,
        etag: resource.etag,
        last_modified: resource.lastModified,
        parity_note: pdf.parity_note,
      });
      return { outcome: "unchanged", message: "PDF hash unchanged", pdf_url: pdf.pdf_url };
    }

    const provenance: Provenance = {
      source_page_url: config.schedulePageUrl,
      source_pdf_url: pdf.pdf_url,
      source_kind: kind,
      downloaded_at: startedAt,
      etag: resource.etag,
      last_modified: resource.lastModified,
      academic_year: pdf.academic_year,
      semester: pdf.semester,
    };
    const applied = await parseAndApply(resource.bytes, provenance, current);
    await saveSourceState({
      last_check_at: startedAt,
      last_result: applied.outcome,
      last_error: applied.outcome === "rejected" ? applied.message : null,
      last_error_at: applied.outcome === "rejected" ? startedAt : state.last_error_at,
      ...(applied.outcome === "updated"
        ? {
            current_pdf_url: pdf.pdf_url,
            current_pdf_hash: hash,
            etag: resource.etag,
            last_modified: resource.lastModified,
            last_success_at: startedAt,
            academic_year: pdf.academic_year,
            semester: pdf.semester,
          }
        : {}),
      parity_note: pdf.parity_note,
    });
    return { ...applied, pdf_url: pdf.pdf_url };
  } catch (error) {
    const message = errorMessage(error);
    const kind = error instanceof SourceFetchError ? error.kind : "unknown";
    log.error("schedule check failed", { error: message, kind });
    await saveSourceState({ last_check_at: startedAt, last_result: "error", last_error: message, last_error_at: startedAt });

    if (!current) {
      const seeded = await seedFromBundledPdf();
      if (seeded) return seeded;
    }
    return { outcome: "error", message };
  }
}

async function parseAndApply(bytes: Uint8Array, provenance: Provenance, current: Schedule | null): Promise<CheckResult> {
  let schedule: Schedule;
  try {
    ({ schedule } = await parsePdf(bytes, provenance));
  } catch (error) {
    const message = `parser failed: ${errorMessage(error)}`;
    log.error(message, { pdf: provenance.source_pdf_url });
    return { outcome: "rejected", message };
  }

  const validation = validateSchedule(schedule, { previousLessonCount: current?.lessons.length ?? null });
  if (!validation.ok) {
    const message = `validation failed: ${validation.errors.join("; ")}`;
    log.error("new schedule rejected, keeping previous version", { errors: validation.errors, pdf: provenance.source_pdf_url });
    return { outcome: "rejected", message };
  }
  for (const warning of validation.warnings) log.warn("validation warning", { warning });

  await replaceCurrentSchedule(schedule);
  log.info("schedule updated", {
    pdf: provenance.source_pdf_url,
    hash: schedule.metadata.source_pdf_hash,
    groups: schedule.groups.length,
    lessons: schedule.lessons.length,
    source_kind: provenance.source_kind,
  });
  return { outcome: "updated", message: `parsed ${schedule.lessons.length} lessons for ${schedule.groups.length} groups`, lessons: schedule.lessons.length };
}

/** Last resort for a cold start without network: a real, previously published FCIM PDF. */
async function seedFromBundledPdf(): Promise<CheckResult | null> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(config.seedPdfPath));
  } catch {
    log.warn("no seed PDF available", { path: config.seedPdfPath });
    return null;
  }
  const now = new Date().toISOString();
  const applied = await parseAndApply(
    bytes,
    {
      source_page_url: config.schedulePageUrl,
      source_pdf_url: config.seedPdfOriginalUrl,
      source_kind: "seed",
      downloaded_at: now,
    },
    null,
  );
  if (applied.outcome !== "updated") return null;
  await saveSourceState({
    current_pdf_url: config.seedPdfOriginalUrl,
    current_pdf_hash: sha256(bytes),
    last_success_at: now,
    last_result: "seeded",
  });
  log.warn("served bundled seed PDF because the live source is unreachable and no cache exists");
  return { outcome: "seeded", message: "bootstrapped from bundled seed PDF", pdf_url: config.seedPdfOriginalUrl, lessons: applied.lessons };
}

/** Bootstraps the cache (if needed) and starts the periodic refresh loop. Idempotent. */
export function startScheduler(): void {
  const globalRef = globalThis as typeof globalThis & { __fcimScheduler?: NodeJS.Timeout };
  if (globalRef.__fcimScheduler) return;

  const tick = () => {
    checkForUpdates().catch((error) => log.error("scheduler tick failed", { error: errorMessage(error) }));
  };
  globalRef.__fcimScheduler = setInterval(tick, config.refreshIntervalMs);
  globalRef.__fcimScheduler.unref?.();
  log.info("scheduler started", { intervalMinutes: config.refreshIntervalMs / 60_000 });
  // Initial bootstrap runs immediately but does not block server startup.
  setTimeout(tick, 0);
}

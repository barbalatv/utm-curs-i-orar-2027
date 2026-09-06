/**
 * Schedule update loop:
 *   discovery or an authenticated official PDF URL
 *   → download → sha256 → parse → validate → atomic replace.
 * Any failure keeps the previous known-good schedule. A bundled real FCIM PDF
 * is also used for cold starts and conservative promotion of older seed data.
 */
import { readFile } from "node:fs/promises";
import { config } from "@/lib/config";
import { errorMessage, getLogger } from "@/lib/logger";
import type { Schedule, ScheduleMetadata, SourceState } from "@/lib/models";
import { parsePdf, sha256, type Provenance } from "@/lib/parser";
import { validateSchedule } from "@/lib/parser/validator";
import { discoverPdf, type DiscoveredPdf, type SemesterSource } from "@/lib/source/discovery";
import {
  fetchOfficialTimetablePdf,
  fetchPdf,
  fetchSchedulePage,
  fetchWordPressSchedulePage,
  SourceFetchError,
  waybackUrl,
  type FetchedResource,
} from "@/lib/source/downloader";
import { splitPdfRevision } from "@/lib/source/revision";
import { getCurrentSchedule, getSourceState, replaceCurrentSchedule, saveSourceState } from "@/lib/storage";

const log = getLogger("updater");

export type CheckOutcome = SourceState["last_result"];

export interface CheckResult {
  outcome: CheckOutcome;
  message: string;
  pdf_url?: string;
  source_pdf_hash?: string;
  groups?: number;
  lessons?: number;
}

interface ExplicitRefreshOptions {
  pdfUrl: string;
  force?: boolean;
}

interface PdfUpdateSource {
  pdfUrl: string;
  downloadUrl: string;
  kind: Extract<ScheduleMetadata["source_kind"], "live" | "wayback" | "manual">;
  fetchMode: "discovered" | "explicit";
  extraHosts?: string[];
  academicYear?: string | null;
  semester?: string | null;
  semesterSource?: SemesterSource | null;
  parityNote?: string | null;
}

type UpdateMode = "automatic" | "explicit";

interface ApplyResult {
  result: CheckResult;
  schedule?: Schedule;
}

let automaticInFlight: Promise<CheckResult> | null = null;
let updateTail: Promise<void> = Promise.resolve();

/** Serialize automatic and administrative updates so two atomic replacements cannot race. */
function enqueueUpdate(run: () => Promise<CheckResult>): Promise<CheckResult> {
  const result = updateTail.then(run, run);
  updateTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Run an automatic check; concurrent ordinary callers share the same run. */
export function checkForUpdates(options: { force?: boolean } = {}): Promise<CheckResult> {
  // A force request is a distinct operation. It still joins the serialization queue,
  // but must run after (rather than inherit) an ordinary in-flight scheduler check.
  if (options.force) return enqueueUpdate(() => runAutomaticCheck(options));
  if (automaticInFlight) return automaticInFlight;
  const task = enqueueUpdate(() => runAutomaticCheck(options));
  automaticInFlight = task;
  const clear = () => {
    if (automaticInFlight === task) automaticInFlight = null;
  };
  void task.then(clear, clear);
  return task;
}

/** Authenticated callers use this path after the API route validates their request. */
export function refreshFromExplicitPdf(options: ExplicitRefreshOptions): Promise<CheckResult> {
  return enqueueUpdate(() => runExplicitRefresh(options));
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

async function runAutomaticCheck(options: { force?: boolean }): Promise<CheckResult> {
  const startedAt = new Date().toISOString();

  try {
    await promoteBundledSeedIfNewer();
    const { pdf, kind } = await discoverCurrentPdf();
    return await updateFromPdfSource(
      {
        pdfUrl: pdf.pdf_url,
        downloadUrl: kind === "wayback" ? waybackUrl(pdf.pdf_url) : pdf.pdf_url,
        kind,
        fetchMode: "discovered",
        extraHosts: kind === "wayback" ? [config.waybackHost] : [],
        academicYear: pdf.academic_year,
        semester: pdf.semester,
        semesterSource: pdf.semester_source,
        parityNote: pdf.parity_note,
      },
      { force: options.force, mode: "automatic", startedAt },
    );
  } catch (error) {
    const message = errorMessage(error);
    const kind = error instanceof SourceFetchError ? error.kind : "unknown";
    log.error("schedule check failed", { error: message, kind });
    await saveSourceState({
      last_check_at: startedAt,
      last_result: "error",
      last_error: message,
      last_error_at: startedAt,
    });

    if (!(await getCurrentSchedule())) {
      try {
        return await seedFromBundledPdf();
      } catch (seedError) {
        const fallbackMessage = `seed fallback failed: ${errorMessage(seedError)}`;
        const combinedMessage = `${message}; ${fallbackMessage}`;
        log.warn("seed fallback failed after automatic discovery error", {
          error: errorMessage(seedError),
          mirror: config.seedPdfMirrorUrl,
        });
        await saveSourceState({
          last_check_at: startedAt,
          last_result: "error",
          last_error: combinedMessage,
          last_error_at: startedAt,
        });
        return { outcome: "error", message: combinedMessage };
      }
    }
    return { outcome: "error", message };
  }
}

async function runExplicitRefresh(options: ExplicitRefreshOptions): Promise<CheckResult> {
  const startedAt = new Date().toISOString();
  try {
    return await updateFromPdfSource(
      {
        pdfUrl: options.pdfUrl,
        downloadUrl: options.pdfUrl,
        kind: "manual",
        fetchMode: "explicit",
      },
      { force: options.force, mode: "explicit", startedAt },
    );
  } catch (error) {
    const message = errorMessage(error);
    const kind = error instanceof SourceFetchError ? error.kind : "unknown";
    log.error("explicit PDF refresh failed, keeping previous version", {
      error: message,
      kind,
      pdf: options.pdfUrl,
    });
    // Automatic discovery health remains untouched. The authenticated response and
    // logs report this recovery failure without erasing the last discovery diagnostic.
    return { outcome: "error", message, pdf_url: options.pdfUrl };
  }
}

async function updateFromPdfSource(
  source: PdfUpdateSource,
  options: { force?: boolean; mode: UpdateMode; startedAt: string },
): Promise<CheckResult> {
  const [state, current] = await Promise.all([getSourceState(), getCurrentSchedule()]);
  const staleParser = current !== null && current.metadata.parser_version !== config.parserVersion;
  const sourceUpgrade = source.kind === "live" && current !== null && current.metadata.source_kind !== "live";
  const sourceUrlChanged = current !== null && current.metadata.source_pdf_url !== source.pdfUrl;
  const mustFetchBody = Boolean(options.force || staleParser || sourceUpgrade || sourceUrlChanged);
  const sameUrl = state.current_pdf_url === source.pdfUrl && current !== null;
  // Explicit recovery always downloads a complete body. Besides making the operation
  // deterministic, this ensures redirect targets and PDF magic are revalidated.
  const conditional =
    source.fetchMode === "discovered" && sameUrl && !mustFetchBody
      ? { etag: state.etag, lastModified: state.last_modified }
      : {};

  const resource = await fetchSourcePdf(source, conditional);
  if (resource.notModified) {
    await recordResult(options.mode, {
      startedAt: options.startedAt,
      outcome: "unchanged",
      message: "PDF not modified (304)",
      source,
    });
    return { outcome: "unchanged", message: "PDF not modified (304)", pdf_url: source.pdfUrl };
  }

  const canonicalPdfUrl = source.fetchMode === "explicit" ? resource.finalUrl : source.pdfUrl;
  const hash = sha256(resource.bytes);
  const provenanceChanged =
    current !== null &&
    (current.metadata.source_pdf_url !== canonicalPdfUrl ||
      (source.kind === "live" && current.metadata.source_kind !== "live"));
  const mustApply = Boolean(options.force || staleParser || provenanceChanged);

  if (!mustApply && current && hash === current.metadata.source_pdf_hash) {
    const message = "PDF hash unchanged";
    await recordResult(options.mode, {
      startedAt: options.startedAt,
      outcome: "unchanged",
      message,
      source,
      canonicalPdfUrl,
      hash,
      resource,
      schedule: current,
    });
    return {
      outcome: "unchanged",
      message,
      pdf_url: canonicalPdfUrl,
      source_pdf_hash: hash,
      groups: current.groups.length,
      lessons: current.lessons.length,
    };
  }

  const provenance: Provenance = {
    source_page_url: config.schedulePageUrl,
    source_pdf_url: canonicalPdfUrl,
    source_kind: source.kind,
    downloaded_at: options.startedAt,
    etag: resource.etag,
    last_modified: resource.lastModified,
    academic_year: source.academicYear,
    semester: source.semester,
    semester_source: source.semesterSource,
  };
  if (staleParser) {
    log.info("re-parsing the cached PDF with the new parser", {
      from: current?.metadata.parser_version,
      to: config.parserVersion,
    });
  }

  const applied = await parseAndApply(resource.bytes, provenance, current);
  await recordResult(options.mode, {
    startedAt: options.startedAt,
    outcome: applied.result.outcome,
    message: applied.result.message,
    source,
    canonicalPdfUrl,
    hash,
    resource,
    schedule: applied.schedule,
  });
  return {
    ...applied.result,
    pdf_url: canonicalPdfUrl,
    source_pdf_hash: applied.schedule?.metadata.source_pdf_hash,
    groups: applied.schedule?.groups.length,
  };
}

async function fetchSourcePdf(
  source: PdfUpdateSource,
  conditional: { etag?: string | null; lastModified?: string | null },
): Promise<FetchedResource> {
  return source.fetchMode === "explicit"
    ? fetchOfficialTimetablePdf(source.downloadUrl, conditional)
    : fetchPdf(source.downloadUrl, conditional, source.extraHosts);
}

async function recordResult(
  mode: UpdateMode,
  details: {
    startedAt: string;
    outcome: CheckOutcome;
    message: string;
    source: PdfUpdateSource;
    canonicalPdfUrl?: string;
    hash?: string;
    resource?: FetchedResource;
    schedule?: Schedule;
  },
): Promise<void> {
  const currentFields =
    details.canonicalPdfUrl && details.hash && details.resource
      ? {
          current_pdf_url: details.canonicalPdfUrl,
          current_pdf_hash: details.hash,
          etag: details.resource.etag,
          last_modified: details.resource.lastModified,
        }
      : {};

  if (mode === "explicit") {
    if (details.outcome === "updated") {
      await saveSourceState({
        ...currentFields,
        last_success_at: details.startedAt,
        academic_year: details.schedule?.metadata.academic_year ?? null,
        semester: details.schedule?.metadata.semester ?? null,
      });
    } else if (details.outcome === "unchanged") {
      await saveSourceState(currentFields);
    }
    return;
  }

  const rejected = details.outcome === "rejected";
  await saveSourceState({
    last_check_at: details.startedAt,
    last_result: details.outcome,
    last_error: rejected ? details.message : null,
    ...(rejected ? { last_error_at: details.startedAt } : {}),
    ...(details.outcome === "updated"
      ? {
          ...currentFields,
          last_success_at: details.startedAt,
          academic_year: details.schedule?.metadata.academic_year ?? details.source.academicYear ?? null,
          semester: details.schedule?.metadata.semester ?? details.source.semester ?? null,
        }
      : details.outcome === "unchanged"
        ? currentFields
        : {}),
    parity_note: details.source.parityNote ?? null,
  });
}

async function parseAndApply(bytes: Uint8Array, provenance: Provenance, current: Schedule | null): Promise<ApplyResult> {
  const built = await buildValidatedSchedule(bytes, provenance, current);
  if (!built.schedule) return { result: built.result };

  await replaceCurrentSchedule(built.schedule);
  log.info("schedule updated", {
    pdf: provenance.source_pdf_url,
    hash: built.schedule.metadata.source_pdf_hash,
    groups: built.schedule.groups.length,
    lessons: built.schedule.lessons.length,
    source_kind: provenance.source_kind,
  });
  return { result: built.result, schedule: built.schedule };
}

/**
 * One deployment serves exactly one course year (SCHEDULE_COURSE_YEAR). A parsed
 * schedule that belongs to another one — the bundled Anul I seed on an Anul II
 * deployment, say — must never be installed, however healthy it looks otherwise.
 * This is the single gate every candidate passes: live, wayback, manual, packaged
 * seed, image seed, repository mirror seed and seed promotion alike.
 */
function courseYearMismatch(schedule: Schedule): string | null {
  const parsed = schedule.metadata.course_year;
  if (parsed === config.courseYear) return null;
  const title = schedule.metadata.pdf_title;
  return (
    `course year mismatch: the PDF belongs to course year ${parsed}` +
    `${title ? ` ("${title}")` : ""}, but this deployment serves course year ${config.courseYear}`
  );
}

async function buildValidatedSchedule(
  bytes: Uint8Array,
  provenance: Provenance,
  current: Schedule | null,
): Promise<ApplyResult> {
  let schedule: Schedule;
  try {
    ({ schedule } = await parsePdf(bytes, provenance));
  } catch (error) {
    const message = `parser failed: ${errorMessage(error)}`;
    log.error(message, { pdf: provenance.source_pdf_url });
    return { result: { outcome: "rejected", message } };
  }

  const mismatch = courseYearMismatch(schedule);
  if (mismatch) {
    log.error("candidate schedule rejected: wrong course year", {
      message: mismatch,
      pdf: provenance.source_pdf_url,
      source_kind: provenance.source_kind,
    });
    return { result: { outcome: "rejected", message: mismatch } };
  }

  const validation = validateSchedule(schedule, { previousLessonCount: current?.lessons.length ?? null });
  if (!validation.ok) {
    const message = `validation failed: ${validation.errors.join("; ")}`;
    log.error("new schedule rejected, keeping previous version", {
      errors: validation.errors,
      pdf: provenance.source_pdf_url,
    });
    return { result: { outcome: "rejected", message } };
  }
  for (const warning of validation.warnings) log.warn("validation warning", { warning });

  return {
    result: {
      outcome: "updated",
      message: `parsed ${schedule.lessons.length} lessons for ${schedule.groups.length} groups`,
      lessons: schedule.lessons.length,
      groups: schedule.groups.length,
      source_pdf_hash: schedule.metadata.source_pdf_hash,
    },
    schedule,
  };
}

async function readBundledSeed(): Promise<{ bytes: Uint8Array; path: string } | null> {
  const paths = [...new Set([config.seedPdfPath, config.imageSeedPdfPath])];
  for (const filePath of paths) {
    try {
      return { bytes: new Uint8Array(await readFile(filePath)), path: filePath };
    } catch {
      // Try the immutable image copy next. The writable data directory may be a mounted volume.
    }
  }
  return null;
}

/**
 * A deployment may contain a newer packaged seed while its persistent volume still
 * holds an older seed. Promote only when URL revision ordering and parsed metadata
 * prove this is a forward move within the exact same academic context.
 */
async function promoteBundledSeedIfNewer(): Promise<void> {
  const current = await getCurrentSchedule();
  if (!current || current.metadata.source_kind !== "seed") return;

  const bundled = await readBundledSeed();
  if (!bundled) return;
  const bundledHash = sha256(bundled.bytes);
  if (
    bundledHash === current.metadata.source_pdf_hash ||
    config.seedPdfOriginalUrl === current.metadata.source_pdf_url ||
    !isNewerPackagedSeedUrl(current.metadata.source_pdf_url, config.seedPdfOriginalUrl)
  ) {
    return;
  }

  const now = new Date().toISOString();
  const built = await buildValidatedSchedule(
    bundled.bytes,
    {
      source_page_url: config.schedulePageUrl,
      source_pdf_url: config.seedPdfOriginalUrl,
      source_kind: "seed",
      downloaded_at: now,
    },
    current,
  );
  if (!built.schedule) {
    log.warn("newer bundled seed was invalid; keeping persisted seed", {
      path: bundled.path,
      error: built.result.message,
    });
    return;
  }
  if (!sameAcademicContext(current, built.schedule)) {
    log.warn("bundled seed academic context differs; keeping persisted seed", {
      current: academicContext(current),
      bundled: academicContext(built.schedule),
    });
    return;
  }

  await replaceCurrentSchedule(built.schedule);
  await saveSourceState({
    current_pdf_url: config.seedPdfOriginalUrl,
    current_pdf_hash: bundledHash,
    etag: null,
    last_modified: null,
    last_success_at: now,
    last_result: "seeded",
    academic_year: built.schedule.metadata.academic_year,
    semester: built.schedule.metadata.semester,
  });
  log.warn("promoted obsolete persisted seed to newer packaged baseline", {
    from: current.metadata.source_pdf_url,
    to: config.seedPdfOriginalUrl,
    hash: bundledHash,
    groups: built.schedule.groups.length,
    lessons: built.schedule.lessons.length,
  });
}

function academicContext(schedule: Schedule) {
  return {
    academicYear: schedule.metadata.academic_year,
    semester: schedule.metadata.semester,
    courseYear: schedule.metadata.course_year,
  };
}

function sameAcademicContext(current: Schedule, bundled: Schedule): boolean {
  const left = academicContext(current);
  const right = academicContext(bundled);
  return (
    left.academicYear !== null &&
    left.academicYear === right.academicYear &&
    left.semester !== null &&
    left.semester === right.semester &&
    left.courseYear === right.courseYear &&
    right.courseYear === config.courseYear
  );
}

interface SeedPublication {
  year: number;
  month: number;
  basename: string;
  revision: number;
}

function seedPublication(rawUrl: string): SeedPublication | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "fcim.utm.md") return null;
  const match = /^\/wp-content\/uploads\/sites\/24\/(\d{4})\/(\d{2})\/([^/]+\.pdf)$/i.exec(url.pathname);
  if (!match) return null;
  const { family, revision } = splitPdfRevision(match[3]);
  return { year: Number(match[1]), month: Number(match[2]), basename: family, revision };
}

function isNewerPackagedSeedUrl(currentUrl: string, bundledUrl: string): boolean {
  const current = seedPublication(currentUrl);
  const bundled = seedPublication(bundledUrl);
  if (!current || !bundled || current.basename !== bundled.basename) return false;
  const currentPeriod = current.year * 12 + current.month;
  const bundledPeriod = bundled.year * 12 + bundled.month;
  return bundledPeriod > currentPeriod || (bundledPeriod === currentPeriod && bundled.revision > current.revision);
}

function verifySeedMirrorHash(bytes: Uint8Array): void {
  const expected = config.seedPdfSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("SCHEDULE_SEED_PDF_SHA256 must contain a 64-character hexadecimal SHA-256");
  }
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`seed mirror SHA-256 mismatch: expected ${expected}, received ${actual}`);
  }
}

/**
 * Last resort for a cold start without network: a real, previously published FCIM PDF.
 * Throws when no seed can be installed, so the caller reports the failure instead of
 * appearing healthy; storage is left untouched in that case.
 */
async function seedFromBundledPdf(): Promise<CheckResult> {
  const bundled = await readBundledSeed();
  let bytes = bundled?.bytes ?? null;
  if (!bytes) {
    try {
      const mirror = await fetchPdf(config.seedPdfMirrorUrl, {}, ["raw.githubusercontent.com"]);
      verifySeedMirrorHash(mirror.bytes);
      bytes = mirror.bytes;
      log.warn("loaded seed PDF from the repository mirror", { url: config.seedPdfMirrorUrl });
    } catch (error) {
      log.warn("no seed PDF available", {
        paths: [...new Set([config.seedPdfPath, config.imageSeedPdfPath])],
        mirror: config.seedPdfMirrorUrl,
        error: errorMessage(error),
      });
      throw error;
    }
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
  if (applied.result.outcome !== "updated" || !applied.schedule) throw new Error(applied.result.message);
  await saveSourceState({
    current_pdf_url: config.seedPdfOriginalUrl,
    current_pdf_hash: applied.schedule.metadata.source_pdf_hash,
    etag: null,
    last_modified: null,
    last_success_at: now,
    last_result: "seeded",
    academic_year: applied.schedule.metadata.academic_year,
    semester: applied.schedule.metadata.semester,
  });
  log.warn("served bundled seed PDF because the live source is unreachable and no cache exists");
  return {
    outcome: "seeded",
    message: "bootstrapped from bundled seed PDF",
    pdf_url: config.seedPdfOriginalUrl,
    source_pdf_hash: applied.schedule.metadata.source_pdf_hash,
    groups: applied.schedule.groups.length,
    lessons: applied.schedule.lessons.length,
  };
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

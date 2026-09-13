/** Operational self-check, with isolated read-only platform scheduler diagnostics. */
import { ConfigError, loadConfig } from "./config";
import { StateStore } from "./state";
import { BrokerClient } from "./broker";
import { PAGE_API_URL } from "./upstream";
import type { PublisherConfig, Transport } from "./types";
import { checkScheduler, type LogonModel, type SchedulerCheck, type SchedulerOptions } from "./scheduler";

// Preserve the existing diagnostic imports for callers.
export { readTaskRegistration } from "./scheduler";
export type { LogonModel, TaskRegistration } from "./scheduler";
export type DoctorCheck = SchedulerCheck;

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  logon_model: LogonModel | "not-applicable";
}

export interface DoctorOptions extends SchedulerOptions {
  transport?: Transport;
  /** When false, the broker is not contacted at all. */
  contactBroker?: boolean;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  let config: PublisherConfig | null = null;
  try {
    config = loadConfig({ env: options.env, requireToken: false });
    add("broker-url", true, config.brokerUrl);
  } catch (err) {
    add("broker-url", false, err instanceof ConfigError ? err.message : String(err));
  }

  const token = (options.env ?? process.env).MD_PUBLISHER_TOKEN ?? "";
  if (!token) {
    add("publisher-token", false, "MD_PUBLISHER_TOKEN is not set");
  } else if (token.length < 32) {
    // The length is a policy fact, not a secret. The value itself is never shown or logged.
    add("publisher-token", false, "MD_PUBLISHER_TOKEN is shorter than 32 characters");
  } else {
    add("publisher-token", true, "configured");
  }

  add("page-api-endpoint", true, PAGE_API_URL);

  if (config) {
    const state = new StateStore(config.stateDir);
    const writable = state.writable();
    add("state-directory", writable, writable ? config.stateDir : `${config.stateDir} is not writable`);
  }

  const scheduler = checkScheduler(options);
  checks.push(...scheduler.checks);

  if (config && options.transport && options.contactBroker !== false && token) {
    try {
      const broker = new BrokerClient({ ...config, token }, options.transport);
      const status = await broker.status();
      add(
        "broker-reachable",
        status.status === 200,
        status.status === 200 ? "publication-status responded 200" : `publication-status responded ${status.status}`,
      );
    } catch (err: unknown) {
      add("broker-reachable", false, (err as Error).message);
    }
  }

  return { ok: checks.every((check) => check.ok), checks, logon_model: scheduler.logon_model };
}

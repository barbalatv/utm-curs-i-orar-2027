/** Diagnostics for the repository's optional Linux user-systemd deployment. */
import fs from "node:fs";
import os from "node:os";
import { posix as path } from "node:path";
import type { CommandRunner, SchedulerCheck } from "./scheduler";

const SERVICE = "fcim-md-publisher.service";
const TIMER = "fcim-md-publisher.timer";
type PathKind = "exists" | "directory" | "readable-file" | "executable" | "private-file";

export interface SystemdOptions {
  /** Injectable account/filesystem boundaries for tests on any platform. */
  homeDir?: string;
  userName?: string;
  inspectPath?: (file: string, kind: PathKind) => boolean;
}

function inspectPath(file: string, kind: PathKind): boolean {
  try {
    // Only metadata/access checks: never read the environment file's contents.
    const stat = fs.statSync(file);
    if (kind === "exists") return true;
    if (kind === "directory") {
      fs.accessSync(file, fs.constants.X_OK);
      return stat.isDirectory();
    }
    fs.accessSync(file, kind === "executable" ? fs.constants.X_OK : fs.constants.R_OK);
    return stat.isFile() && (kind !== "private-file" || (stat.mode & 0o077) === 0);
  } catch {
    return false;
  }
}

function properties(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    // Array properties such as EnvironmentFiles are printed once per entry.
    result[name] = result[name] === undefined ? value : `${result[name]}\n${value}`;
  }
  return result;
}

export function checkUserSystemd(run: CommandRunner, options: SystemdOptions = {}): SchedulerCheck[] {
  const checks: SchedulerCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const home = options.homeDir ?? os.homedir();
  const inspect = options.inspectPath ?? inspectPath;
  const localUnits = [SERVICE, TIMER].some((unit) => inspect(path.join(home, ".config/systemd/user", unit), "exists"));

  let service: Record<string, string>;
  let timer: Record<string, string>;
  try {
    // Do not request Environment, full unit text, journal entries, or shell output.
    service = properties(run("systemctl", ["--user", "show", SERVICE, "--no-pager",
      "--property=LoadState,Type,WorkingDirectory,ExecStart,EnvironmentFiles"]));
    timer = properties(run("systemctl", ["--user", "show", TIMER, "--no-pager",
      "--property=LoadState,UnitFileState,ActiveState,Triggers"]));
  } catch (err) {
    const commandMissing = (err as NodeJS.ErrnoException).code === "ENOENT";
    add("systemd-scheduler", commandMissing && !localUnits, commandMissing && !localUnits
      ? "systemctl is not installed and no publisher user units were found; manual CLI available"
      : "Cannot query the user systemd manager; run doctor as the publisher account in its user session. Scheduler state is unverified");
    // Never echo subprocess errors: they can include command output or credentials.
    return checks;
  }

  if (service.LoadState === "not-found" && timer.LoadState === "not-found" && !localUnits) {
    add("systemd-scheduler", true, "No publisher user service/timer installed; manual CLI available. Install the documented units for scheduled operation");
    return checks;
  }
  add("systemd-service", service.LoadState === "loaded",
    service.LoadState === "loaded" ? `${SERVICE} is loaded` : `${SERVICE} is missing, masked, invalid, or unavailable; inspect its user unit installation`);
  add("systemd-timer", timer.LoadState === "loaded",
    timer.LoadState === "loaded" ? `${TIMER} is loaded` : `${TIMER} is missing, masked, invalid, or unavailable; inspect its user unit installation`);

  if (timer.LoadState === "loaded") {
    const targetsService = timer.Triggers?.split(/\s+/).includes(SERVICE) ?? false;
    add("systemd-timer-enabled", timer.UnitFileState === "enabled",
      timer.UnitFileState === "enabled" ? `${TIMER} is enabled` : `${TIMER} is not persistently enabled; use systemctl --user enable ${TIMER}`);
    add("systemd-timer-active", timer.ActiveState === "active",
      timer.ActiveState === "active" ? `${TIMER} is active` : `${TIMER} is not active; inspect its status and start it after verification`);
    add("systemd-timer-target", targetsService,
      targetsService ? `Timer activates ${SERVICE}` : `Timer does not report ${SERVICE} as its target`);
  }

  if (service.LoadState === "loaded") {
    add("systemd-service-type", service.Type === "oneshot",
      service.Type === "oneshot" ? "Type=oneshot; a static service inactive between timer runs is normal" : "Expected Type=oneshot; inspect the installed service");
    const directory = service.WorkingDirectory ?? "";
    const directoryOk = path.isAbsolute(directory) && inspect(directory, "directory");
    add("systemd-working-directory", directoryOk,
      directoryOk ? "Service working directory exists and is accessible" : "Service working directory is missing, inaccessible, or not an absolute path");
    // systemctl show serializes ExecStart as { path=... ; argv[]=... ; ... }.
    // Inspect only the executable path; never print the raw command or arguments.
    const executable = /^\{\s*path=([^;]+?)\s*;/.exec(service.ExecStart ?? "")?.[1] ?? "";
    const executableOk = path.isAbsolute(executable) && inspect(executable, "executable");
    add("systemd-executable", executableOk,
      executableOk ? "ExecStart executable exists and is executable" : "Cannot verify the ExecStart executable; inspect the installed service path");
    const entry = path.join(directory, "tools/md-publisher/dist/tools/md-publisher/src/index.js");
    const entryOk = directoryOk && inspect(entry, "readable-file");
    add("systemd-publisher-build", entryOk,
      entryOk ? "Compiled publisher entry point is readable under the service working directory" : "Compiled publisher entry point is missing or unreadable; run npm run build:publisher in the checkout");

    const envFile = path.join(home, ".config/fcim-md-publisher/env");
    const configured = (service.EnvironmentFiles ?? "").split(/\s+\(ignore_errors=(?:yes|no)\)(?:\s+|$)/).includes(envFile);
    const readable = configured && inspect(envFile, "readable-file");
    add("systemd-environment-file", readable, !configured
      ? "Service does not reference ~/.config/fcim-md-publisher/env; inspect EnvironmentFile configuration"
      : readable ? "Service references readable ~/.config/fcim-md-publisher/env; contents are not inspected"
        : "Expected ~/.config/fcim-md-publisher/env is missing or unreadable; contents are not inspected");
    if (configured) {
      add("systemd-environment-permissions", inspect(envFile, "private-file"),
        "Environment file must be readable by this account with no group/other permissions (chmod 600); contents are not inspected");
    }
  }

  try {
    const user = options.userName ?? os.userInfo().username;
    const linger = run("loginctl", ["show-user", user, "--property=Linger", "--value"]).trim();
    add("systemd-linger", linger === "yes", linger === "yes"
      ? "Linger=yes; the user manager can run without an active login session"
      : "Linger=yes is not confirmed; an operator must enable linger for autonomous operation");
  } catch {
    add("systemd-linger", false, "Cannot verify Linger; inspect loginctl show-user for the publisher account. Doctor does not change it");
  }
  return checks;
}

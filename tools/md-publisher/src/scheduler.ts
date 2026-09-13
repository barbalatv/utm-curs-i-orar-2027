/** Read-only scheduler diagnostics. Publication itself never depends on a scheduler. */
import { execFileSync } from "node:child_process";

import { loadTaskName, SCHEDULED_TASK_NAME } from "./config";
import { checkUserSystemd, type SystemdOptions } from "./systemd";

export type LogonModel = "Interactive" | "Password" | "S4U" | "InteractiveOrPassword" | "Unknown";
export type CommandRunner = (command: string, args: string[]) => string;
export interface SchedulerCheck {
  name: string;
  ok: boolean;
  detail: string;
}
export interface TaskRegistration {
  installed: boolean;
  logonModel: LogonModel;
  detail: string;
}
export interface SchedulerReport {
  checks: SchedulerCheck[];
  logon_model: LogonModel | "not-applicable";
}

export interface SchedulerOptions extends SystemdOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  runCommand?: CommandRunner;
}

const LOGON_TYPE_MAP: Record<string, LogonModel> = {
  InteractiveToken: "Interactive",
  Password: "Password",
  S4U: "S4U",
  InteractiveTokenOrPassword: "InteractiveOrPassword",
};

function defaultRunner(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000, maxBuffer: 128 * 1024, windowsHide: true,
  });
}

/** Read only the registered task definition; never create or repair registrations. */
export function readTaskRegistration(
  run: CommandRunner = defaultRunner,
  taskName: string = SCHEDULED_TASK_NAME,
  platform: NodeJS.Platform = process.platform,
): TaskRegistration {
  if (platform !== "win32") {
    return { installed: false, logonModel: "Unknown", detail: "Windows Task Scheduler is not available on this platform" };
  }
  let xml: string;
  try {
    xml = run("schtasks", ["/Query", "/TN", taskName, "/XML", "ONE"]);
  } catch {
    return { installed: false, logonModel: "Unknown", detail: `No scheduled task named "${taskName}"` };
  }
  const match = /<LogonType>([^<]+)<\/LogonType>/i.exec(xml);
  if (!match) {
    return { installed: true, logonModel: "Interactive", detail: "Task defines no explicit LogonType" };
  }
  const model = LOGON_TYPE_MAP[match[1].trim()] ?? "Unknown";
  return { installed: true, logonModel: model, detail: `LogonType=${match[1].trim()}` };
}

export function checkScheduler(options: SchedulerOptions = {}): SchedulerReport {
  const platform = options.platform ?? process.platform;
  const run = options.runCommand ?? defaultRunner;
  if (platform === "linux") {
    return { checks: checkUserSystemd(run, options), logon_model: "not-applicable" };
  }
  if (platform !== "win32") {
    return {
      checks: [{ name: "scheduled-task", ok: true, detail: "Scheduler diagnostics not applicable on this platform; manual CLI available" }],
      logon_model: "not-applicable",
    };
  }

  const taskName = loadTaskName(options.env);
  const registration = readTaskRegistration(run, taskName, platform);
  let logonModel: SchedulerReport["logon_model"] = "not-applicable";
  let ok = false;
  let detail: string;
  if (!registration.installed) {
    detail = `${registration.detail}; run install-task.ps1 -LogonMode Interactive`;
  } else if (registration.logonModel === "S4U") {
    logonModel = "S4U";
    detail = `Task "${taskName}" is registered with S4U. Re-register it: .\\install-task.ps1 -LogonMode Interactive ` +
      `-TaskName '${taskName.replace(/'/g, "''")}' ` +
      '(or -LogonMode Password -User "<account>" if it must run before logon).';
  } else {
    logonModel = registration.logonModel;
    ok = true;
    detail = `Task "${taskName}": logon model: ${registration.logonModel} (${registration.detail})`;
  }
  return { checks: [{ name: "scheduled-task", ok, detail }], logon_model: logonModel };
}

import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../tools/md-publisher/src/doctor";
import { checkScheduler, readTaskRegistration } from "../tools/md-publisher/src/scheduler";

const HOME = "/home/publisher";
const CHECKOUT = `${HOME}/utm-curs-i-orar-2027`;
const ENTRY = `${CHECKOUT}/tools/md-publisher/dist/tools/md-publisher/src/index.js`;
const ENV_FILE = `${HOME}/.config/fcim-md-publisher/env`;
const SERVICE = "fcim-md-publisher.service";
const TIMER = "fcim-md-publisher.timer";
const SECRET = "secret-must-never-appear-in-scheduler-diagnostics";

function linuxFixture() {
  const service: Record<string, string> = {
    LoadState: "loaded", Type: "oneshot", WorkingDirectory: CHECKOUT,
    ExecStart: `{ path=/usr/bin/node ; argv[]=/usr/bin/node ${ENTRY} publish ; ignore_errors=no ; }`,
    EnvironmentFiles: `${ENV_FILE} (ignore_errors=no)`,
  };
  const timer: Record<string, string> = {
    LoadState: "loaded", UnitFileState: "enabled", ActiveState: "active", Triggers: SERVICE,
  };
  const state = { linger: "yes" };
  const inspectPath = vi.fn((_file: string, _kind: string) => true);
  const runCommand = vi.fn((command: string, args: string[]) => {
    if (command === "loginctl") return state.linger;
    const record = args.includes(SERVICE) ? service : timer;
    return Object.entries(record).map(([key, value]) => `${key}=${value}`).join("\n");
  });
  const options = { platform: "linux" as const, homeDir: HOME, userName: "publisher", inspectPath, runCommand };
  return { options, service, timer, state, runCommand, inspectPath };
}

afterEach(() => vi.restoreAllMocks());

describe("Linux user-systemd scheduler diagnostics", () => {
  it("accepts the production timer/oneshot model without requiring an active or enabled service", () => {
    const fixture = linuxFixture();
    fixture.service.ActiveState = "inactive";
    fixture.service.UnitFileState = "static";
    fixture.service.Restart = "no";
    const report = checkScheduler(fixture.options);
    expect(report.logon_model).toBe("not-applicable");
    expect(report.checks.length).toBeGreaterThan(8);
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(fixture.inspectPath).toHaveBeenCalledWith(ENV_FILE, "private-file");
    expect(fixture.inspectPath).toHaveBeenCalledWith(ENTRY, "readable-file");
    expect(fixture.inspectPath).toHaveBeenCalledWith("/usr/bin/node", "executable");
    expect(fixture.runCommand.mock.calls).toEqual([
      ["systemctl", ["--user", "show", SERVICE, "--no-pager", "--property=LoadState,Type,WorkingDirectory,ExecStart,EnvironmentFiles"]],
      ["systemctl", ["--user", "show", TIMER, "--no-pager", "--property=LoadState,UnitFileState,ActiveState,Triggers"]],
      ["loginctl", ["show-user", "publisher", "--property=Linger", "--value"]],
    ]);
  });

  it.each(["service", "timer"] as const)("reports a missing %s when the other unit is present", (unit) => {
    const fixture = linuxFixture();
    fixture[unit].LoadState = "not-found";
    expect(checkScheduler(fixture.options).checks).toContainEqual(expect.objectContaining({ name: `systemd-${unit}`, ok: false }));
  });

  it.each([
    ["UnitFileState", "disabled", "systemd-timer-enabled"],
    ["UnitFileState", "enabled-runtime", "systemd-timer-enabled"],
    ["ActiveState", "inactive", "systemd-timer-active"],
    ["ActiveState", "failed", "systemd-timer-active"],
    ["Triggers", "other.service", "systemd-timer-target"],
    ["LoadState", "masked", "systemd-timer"],
  ])("detects timer %s=%s", (property, value, name) => {
    const fixture = linuxFixture();
    fixture.timer[property] = value;
    expect(checkScheduler(fixture.options).checks).toContainEqual(expect.objectContaining({ name, ok: false }));
  });

  it("does not mistake a previous failed publication for a broken scheduler", () => {
    const fixture = linuxFixture();
    fixture.service.ActiveState = "failed";
    expect(checkScheduler(fixture.options).checks.every((check) => check.ok)).toBe(true);
  });

  it.each(["no", "", "unknown"])("reports unconfirmed Linger=%s", (linger) => {
    const fixture = linuxFixture();
    fixture.state.linger = linger;
    expect(checkScheduler(fixture.options).checks).toContainEqual(expect.objectContaining({ name: "systemd-linger", ok: false }));
  });

  it("reports unavailable loginctl without exposing command output or elevating", () => {
    const fixture = linuxFixture();
    const normalRun = fixture.runCommand.getMockImplementation()!;
    fixture.runCommand.mockImplementation((command, args) => {
      if (command === "loginctl") throw new Error(SECRET);
      return normalRun(command, args);
    });
    const report = checkScheduler(fixture.options);
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "systemd-linger", ok: false }));
    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect(fixture.runCommand.mock.calls.map(([command]) => command)).toEqual(["systemctl", "systemctl", "loginctl"]);
  });

  it.each([true, false])("reports an unreachable user manager as unverified (local units: %s)", (installed) => {
    const fixture = linuxFixture();
    fixture.inspectPath.mockReturnValue(installed);
    fixture.runCommand.mockImplementation(() => { throw new Error(`Failed to connect to bus ${SECRET}`); });
    const report = checkScheduler(fixture.options);
    expect(report.checks).toEqual([expect.objectContaining({ name: "systemd-scheduler", ok: false, detail: expect.stringContaining("unverified") })]);
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it("allows manual operation when systemctl and local publisher units are absent", () => {
    const fixture = linuxFixture();
    fixture.inspectPath.mockReturnValue(false);
    fixture.runCommand.mockImplementation(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); });
    expect(checkScheduler(fixture.options).checks).toEqual([expect.objectContaining({ ok: true, detail: expect.stringContaining("manual CLI") })]);
    fixture.inspectPath.mockReturnValue(true);
    expect(checkScheduler(fixture.options).checks[0].ok).toBe(false);
  });

  it("distinguishes an uninstalled scheduler from installed units invisible to the manager", () => {
    const fixture = linuxFixture();
    fixture.service.LoadState = fixture.timer.LoadState = "not-found";
    fixture.inspectPath.mockReturnValue(false);
    expect(checkScheduler(fixture.options).checks).toEqual([expect.objectContaining({ ok: true, detail: expect.stringContaining("No publisher user service/timer installed") })]);
    fixture.inspectPath.mockReturnValue(true);
    expect(checkScheduler(fixture.options).checks.filter((check) => !check.ok).map((check) => check.name))
      .toEqual(["systemd-service", "systemd-timer"]);
  });

  it("does not report empty or unrecognized systemctl output as a healthy deployment", () => {
    const fixture = linuxFixture();
    fixture.runCommand.mockReturnValue("");
    expect(checkScheduler(fixture.options).checks).toContainEqual(expect.objectContaining({ name: "systemd-service", ok: false }));
  });

  it.each([
    [CHECKOUT, "directory", "systemd-working-directory"],
    [ENTRY, "readable-file", "systemd-publisher-build"],
    ["/usr/bin/node", "executable", "systemd-executable"],
    [ENV_FILE, "readable-file", "systemd-environment-file"],
    [ENV_FILE, "private-file", "systemd-environment-permissions"],
  ])("diagnoses a missing/inaccessible path or unsafe permissions: %s %s", (file, kind, name) => {
    const fixture = linuxFixture();
    fixture.inspectPath.mockImplementation((candidate, checkKind) => candidate !== file || checkKind !== kind);
    expect(checkScheduler(fixture.options).checks).toContainEqual(expect.objectContaining({ name, ok: false }));
  });

  it("flags unexpected service type, environment reference and missing executable metadata", () => {
    const fixture = linuxFixture();
    fixture.service.Type = "simple";
    fixture.service.EnvironmentFiles = `${HOME}/another-env (ignore_errors=no)`;
    fixture.service.ExecStart = "";
    expect(checkScheduler(fixture.options).checks.filter((check) => !check.ok).map((check) => check.name))
      .toEqual(["systemd-service-type", "systemd-executable", "systemd-environment-file"]);
  });

  it("recognizes the expected environment file among repeated systemctl properties", () => {
    const fixture = linuxFixture();
    fixture.service.EnvironmentFiles += `\nEnvironmentFiles=${HOME}/extra-env (ignore_errors=yes)`;
    expect(checkScheduler(fixture.options).checks).toContainEqual(expect.objectContaining({ name: "systemd-environment-file", ok: true }));
  });

  it.each([[0o100600, true], [0o100400, true], [0o100640, false], [0o100604, false]])(
    "checks real permission bits without opening the environment file (mode %s)", (mode, ok) => {
      const fixture = linuxFixture();
      const stat = fs.statSync(__filename);
      stat.mode = mode as number;
      vi.spyOn(fs, "statSync").mockReturnValue(stat);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);
      const read = vi.spyOn(fs, "readFileSync");
      const report = checkScheduler({ ...fixture.options, inspectPath: undefined });
      expect(report.checks).toContainEqual(expect.objectContaining({ name: "systemd-environment-permissions", ok }));
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("checks only filesystem metadata, never file contents or environment/argv values", () => {
    const fixture = linuxFixture();
    const stat = fs.statSync(__filename);
    vi.spyOn(fs, "statSync").mockReturnValue(stat);
    vi.spyOn(fs, "accessSync").mockReturnValue(undefined);
    const read = vi.spyOn(fs, "readFileSync");
    fixture.service.ExecStart += SECRET;
    fixture.service.Environment = `MD_PUBLISHER_TOKEN=${SECRET}`;
    const report = checkScheduler({ ...fixture.options, inspectPath: undefined });
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it("integrates Linux failures into doctor even without broker configuration", async () => {
    const fixture = linuxFixture();
    fixture.timer.ActiveState = "inactive";
    const report = await runDoctor({ ...fixture.options, env: {}, contactBroker: false });
    expect(report.ok).toBe(false);
    expect(report.logon_model).toBe("not-applicable");
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "systemd-timer-active", ok: false }));
  });
});

describe("portable scheduler routing", () => {
  it.each([
    ["InteractiveToken", "Interactive", true], ["Password", "Password", true],
    ["InteractiveTokenOrPassword", "InteractiveOrPassword", true], ["S4U", "S4U", false],
  ])("keeps Windows %s behavior on any test host", (xmlModel, model, ok) => {
    const runCommand = vi.fn(() => `<LogonType>${xmlModel}</LogonType>`);
    const report = checkScheduler({ platform: "win32", env: {}, runCommand });
    expect(report.logon_model).toBe(model);
    expect(report.checks[0].ok).toBe(ok);
    expect(runCommand).toHaveBeenCalledExactlyOnceWith("schtasks", ["/Query", "/TN", "FCIM MD Publisher", "/XML", "ONE"]);
  });

  it("retains Windows missing-task and implicit-interactive handling", () => {
    expect(readTaskRegistration(() => "<Principal />", undefined, "win32").logonModel).toBe("Interactive");
    const runCommand = () => { throw new Error("not installed"); };
    expect(checkScheduler({ platform: "win32", env: {}, runCommand }).checks[0])
      .toEqual(expect.objectContaining({ ok: false, detail: expect.stringContaining("install-task.ps1") }));
  });

  it("does not launch platform probes on other operating systems", () => {
    const runCommand = vi.fn();
    expect(checkScheduler({ platform: "darwin", runCommand }).checks[0].ok).toBe(true);
    expect(runCommand).not.toHaveBeenCalled();
  });
});

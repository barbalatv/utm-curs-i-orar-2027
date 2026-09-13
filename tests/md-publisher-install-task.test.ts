import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../tools/md-publisher/src/cli";
import { loadConfig } from "../tools/md-publisher/src/config";
import { runDoctor } from "../tools/md-publisher/src/doctor";
import { StateStore } from "../tools/md-publisher/src/state";
import { createTestTransport, FAKE_BROKER_ORIGIN } from "./helpers/md-publisher-transport";
import { pagePayload, pdfBody } from "./helpers/md-publication";
import { createHarness, TEST_PUBLISHER_TOKEN } from "./helpers/worker-doubles";

const installer = path.resolve("tools/md-publisher/install-task.ps1");
const fixture = path.resolve("tests/fixtures/publisher-install-harness.ps1");
const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// Runs in Linux CI too. Windows cases below verify the actual native argument round trip.
it("forwards custom state through the shared scheduled action for both logon models", () => {
  const source = fs.readFileSync(installer, "utf8");
  expect(source).toContain('$arguments += " --state-dir $(Quote-NativeArgument $StateDir)"');
  expect(source).toContain('-Argument $arguments');
  expect(source).toContain("$config['task_name'] = $TaskName");
  expect(source.match(/New-ScheduledTaskAction -Execute/g)).toHaveLength(1);
});

describe.skipIf(process.platform !== "win32")("Windows publisher installer action", () => {
  for (const logonMode of ["Interactive", "Password"]) {
    it.each(["default", "absolute", "relative"])(`${logonMode}: preserves %s state directory and task name`, async (kind) => {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "publisher install "));
      scratchDirs.push(scratch);
      const checkout = path.join(scratch, "checkout with spaces");
      fs.mkdirSync(checkout);
      const copy = path.join(checkout, "install-task.ps1");
      fs.copyFileSync(installer, copy);
      const entry = path.join(checkout, "dist/tools/md-publisher/src/index.js");
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, 'require("node:fs").writeFileSync(process.env.PUBLISHER_ARGV_CAPTURE, JSON.stringify(process.argv.slice(2)));');
      const custom = kind === "absolute"
        ? path.join(scratch, "state O'Brien & $(literal); space") + "\\"
        : kind === "relative" ? "relative state" : undefined;
      const expectedDir = kind === "default"
        ? path.join(scratch, "Local App Data", "fcim-md-publisher")
        : path.resolve(scratch, custom!);
      const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture,
        "-Installer", copy, "-Scratch", scratch, "-LogonMode", logonMode];
      if (custom) args.push("-CustomStateDir", custom);
      const output = execFileSync("powershell.exe", args, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
      const registration = JSON.parse(fs.readFileSync(path.join(scratch, "registration.json"), "utf8").replace(/^\uFEFF/, ""));
      expect(registration.LogonType).toBe(logonMode);
      expect(registration.ReceivedPassword).toBe(logonMode === "Password");
      expect(registration.Action.Execute).toBe(process.execPath);
      expect(registration.Action.Argument).not.toMatch(/fixture-password|fixture-token/);
      const argv: string[] = JSON.parse(fs.readFileSync(path.join(scratch, "argv.json"), "utf8"));
      if (kind === "default") {
        expect(argv).toEqual(["publish"]);
      } else {
        expect(argv.slice(0, 2)).toEqual(["publish", "--state-dir"]);
        expect(path.resolve(argv[2])).toBe(expectedDir);
      }
      // The printed manual verification command also preserves PowerShell metacharacters.
      const verify = output.match(/Verify with:\s+([^\r\n]+)/)?.[1];
      expect(verify).toBeDefined();
      const verifyCapture = path.join(scratch, "verify-argv.json");
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", verify!], {
        env: { ...process.env, PUBLISHER_ARGV_CAPTURE: verifyCapture }, windowsHide: true, timeout: 30_000,
      });
      const verifyArgv = JSON.parse(fs.readFileSync(verifyCapture, "utf8"));
      expect(verifyArgv.slice(0, 2)).toEqual(["doctor", "--state-dir"]);
      expect(path.resolve(verifyArgv[2])).toBe(expectedDir);
      const env = { MD_PUBLISHER_BROKER_URL: FAKE_BROKER_ORIGIN, MD_PUBLISHER_TOKEN: TEST_PUBLISHER_TOKEN,
        MD_PUBLISHER_STATE_DIR: kind === "default" ? expectedDir : path.join(scratch, "wrong state") };
      const broker = createHarness();
      const { transport } = createTestTransport(broker, {
        page: () => ({ status: 200, body: pagePayload() }),
        pdf: (url) => ({ status: 200, body: pdfBody(url) }),
      });
      const err = vi.fn();
      expect(await main(argv, { env, transport, out: () => {}, err })).toBe(0);
      expect(err).not.toHaveBeenCalled();
      expect(new StateStore(expectedDir).readLastRun()?.outcome).toBe("published");
      const installedEnv = { ...env, MD_PUBLISHER_STATE_DIR: expectedDir };
      expect(loadConfig({ env: installedEnv }).logonModel).toBe(logonMode);
      const runCommand = vi.fn(() => `<LogonType>${logonMode === "Interactive" ? "InteractiveToken" : "Password"}</LogonType>`);
      await runDoctor({ env: installedEnv, contactBroker: false, runCommand });
      expect(runCommand).toHaveBeenCalledWith("schtasks", ["/Query", "/TN", "Custom Publisher", "/XML", "ONE"]);
    });
  }
});

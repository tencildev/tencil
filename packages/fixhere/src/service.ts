import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT, probeDaemon } from "./daemon.ts";
import { VERSION } from "./version.ts";

const LABEL = "dev.fixhere.daemon";

export interface DaemonCommand {
  /** Absolute path of the node binary. */
  node: string;
  /** Absolute path of the fixhere CLI entry. */
  cli: string;
  port: number;
  /** Extra daemon flags (model, runtime mode, …) passed through from `start`. */
  args?: string[];
}

function daemonArgs(command: DaemonCommand): string[] {
  return [command.cli, "daemon", "--port", String(command.port), ...(command.args ?? [])];
}

/**
 * Start the daemon in the background unless it already runs. A daemon from an
 * older Fixhere version is replaced so pages always get the current overlay.
 */
export async function startInBackground(
  command: DaemonCommand,
  dataDir: string,
): Promise<{ status: "started" | "running" | "restarted"; pid: number }> {
  const running = await probeDaemon(command.port);
  if (running && running.version === VERSION) return { status: "running", pid: running.pid };
  if (running) await stopDaemon(command.port);

  mkdirSync(dataDir, { recursive: true });
  const logFile = openSync(join(dataDir, "daemon.log"), "a");
  const child = spawn(command.node, daemonArgs(command), {
    detached: true,
    stdio: ["ignore", logFile, logFile],
    windowsHide: true,
  });
  child.unref();

  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const health = await probeDaemon(command.port);
    if (health) return { status: running ? "restarted" : "started", pid: health.pid };
  }
  throw new Error(`The daemon didn't start. See ${join(dataDir, "daemon.log")}.`);
}

/** Stop the daemon answering on `port`. Returns false when none was running. */
export async function stopDaemon(port = DEFAULT_PORT): Promise<boolean> {
  const running = await probeDaemon(port);
  if (!running) return false;
  try {
    process.kill(running.pid, "SIGTERM");
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!(await probeDaemon(port))) return true;
  }
  return true;
}

/* ------------------------------ login service ------------------------------ */

export function launchdPlist(command: DaemonCommand, logPath: string): string {
  const args = [command.node, ...daemonArgs(command)]
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

export function systemdUnit(command: DaemonCommand): string {
  return `[Unit]
Description=Fixhere daemon

[Service]
ExecStart=${[command.node, ...daemonArgs(command)].map((arg) => `"${arg}"`).join(" ")}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

export function windowsTaskCommand(command: DaemonCommand): string {
  return [command.node, ...daemonArgs(command)].map((arg) => `"${arg}"`).join(" ");
}

/** npx keeps packages in a cache it may clean; a login service needs a stable install. */
export function isEphemeralInstall(cliPath: string): boolean {
  return /[\\/]_npx[\\/]/.test(cliPath);
}

export async function installService(command: DaemonCommand, dataDir: string): Promise<string> {
  const logPath = join(dataDir, "daemon.log");
  mkdirSync(dataDir, { recursive: true });
  // The service takes over; don't leave a second daemon fighting for the port.
  await stopDaemon(command.port);

  switch (process.platform) {
    case "darwin": {
      const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
      mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
      writeFileSync(plist, launchdPlist(command, logPath));
      const domain = `gui/${process.getuid?.() ?? 501}`;
      try {
        execFileSync("launchctl", ["bootout", domain, plist], { stdio: "ignore" });
      } catch {
        // Not loaded yet.
      }
      execFileSync("launchctl", ["bootstrap", domain, plist]);
      return plist;
    }
    case "linux": {
      const dir = join(homedir(), ".config", "systemd", "user");
      mkdirSync(dir, { recursive: true });
      const unit = join(dir, "fixhere.service");
      writeFileSync(unit, systemdUnit(command));
      execFileSync("systemctl", ["--user", "daemon-reload"]);
      execFileSync("systemctl", ["--user", "enable", "--now", "fixhere.service"]);
      return unit;
    }
    case "win32":
      execFileSync("schtasks", [
        "/Create",
        "/F",
        "/SC",
        "ONLOGON",
        "/TN",
        "Fixhere",
        "/TR",
        windowsTaskCommand(command),
      ]);
      execFileSync("schtasks", ["/Run", "/TN", "Fixhere"]);
      return "Task Scheduler: Fixhere";
    default:
      throw new Error(
        `Login service isn't supported on ${process.platform}; use \`fixhere start\`.`,
      );
  }
}

export async function uninstallService(port = DEFAULT_PORT): Promise<void> {
  switch (process.platform) {
    case "darwin": {
      const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
      try {
        execFileSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}`, plist], {
          stdio: "ignore",
        });
      } catch {
        // Already unloaded.
      }
      rmSync(plist, { force: true });
      break;
    }
    case "linux":
      try {
        execFileSync("systemctl", ["--user", "disable", "--now", "fixhere.service"], {
          stdio: "ignore",
        });
      } catch {
        // Already gone.
      }
      rmSync(join(homedir(), ".config", "systemd", "user", "fixhere.service"), { force: true });
      break;
    case "win32":
      try {
        execFileSync("schtasks", ["/Delete", "/F", "/TN", "Fixhere"], { stdio: "ignore" });
      } catch {
        // Already gone.
      }
      break;
  }
  await stopDaemon(port);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

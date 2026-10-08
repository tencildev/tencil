import { describe, expect, it } from "vitest";
import { isEphemeralInstall, launchdPlist, systemdUnit, windowsTaskCommand } from "./service.ts";

const command = {
  node: "/usr/local/bin/node",
  cli: "/usr/local/lib/node_modules/fixhere/dist/cli.mjs",
  port: 4747,
  args: ["--model", "codex:gpt-test"],
};

describe("login service definitions", () => {
  it("runs the daemon with the chosen flags under launchd", () => {
    const plist = launchdPlist(command, "/Users/me/.config/fixhere/daemon.log");
    expect(plist).toContain("<string>dev.fixhere.daemon</string>");
    expect(plist).toContain("<string>daemon</string>");
    expect(plist).toContain("<string>codex:gpt-test</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
  });

  it("writes a systemd user unit and a Windows task command", () => {
    expect(systemdUnit(command)).toContain(
      'ExecStart="/usr/local/bin/node" "/usr/local/lib/node_modules/fixhere/dist/cli.mjs" "daemon" "--port" "4747"',
    );
    expect(windowsTaskCommand(command)).toContain('"daemon" "--port" "4747" "--model"');
  });

  it("refuses npx cache installs for a login service", () => {
    expect(isEphemeralInstall("/Users/me/.npm/_npx/abc123/node_modules/fixhere/dist/cli.mjs")).toBe(
      true,
    );
    expect(isEphemeralInstall(command.cli)).toBe(false);
  });
});

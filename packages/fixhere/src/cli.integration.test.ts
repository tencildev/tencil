import { execFile } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));

/** Runs the built CLI with its own config folder and a T3 Code that isn't there. */
function cli(args: string[], env: Record<string, string>) {
  return run(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...env, FIXHERE_T3_URL: "http://127.0.0.1:1", NO_COLOR: "1" },
    timeout: 20_000,
  }).then(
    (result) => ({ code: 0, out: result.stdout }),
    (error: { code?: number; stdout?: string }) => ({
      code: error.code ?? 1,
      out: error.stdout ?? "",
    }),
  );
}

describe.skipIf(!existsSync(CLI))("fixhere CLI daemon lifecycle (built)", () => {
  it("starts in the background, reports status, reuses a running daemon and stops", async () => {
    const env = {
      XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "fixhere-cli-")),
      FIXHERE_PORT: String(48_500 + Math.floor(Math.random() * 400)),
    };
    try {
      const started = await cli(["start"], env);
      expect(started.out).toMatch(/Fixhere started/);

      const status = await cli(["status"], env);
      expect(status.code).toBe(0);
      expect(status.out).toMatch(/Fixhere v/);

      const again = await cli(["start"], env);
      expect(again.out).toMatch(/is running/);
    } finally {
      const stopped = await cli(["stop"], env);
      expect(stopped.out).toMatch(/Stopped/);
    }
    const after = await cli(["status"], env);
    expect(after.code).toBe(1);
  });
});

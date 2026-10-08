import { type FixhereInstance, type FixhereOptions, startFixhere } from "./index.ts";

type NextConfigObject = Record<string, unknown> & { env?: Record<string, string | undefined> };
type NextConfigInput =
  | NextConfigObject
  | ((phase: string, context: unknown) => NextConfigObject | Promise<NextConfigObject>);

const DEV_PHASE = "phase-development-server";
const SINGLETON = Symbol.for("fixhere.next.instance");

/**
 * Wrap your Next.js config: during `next dev` the bridge starts with the dev
 * server (or attaches to the one already running for this project) and its
 * script URL is exposed to `<Fixhere />`. Other phases are untouched.
 *
 *   export default withFixhere(nextConfig);
 */
export function withFixhere(config: NextConfigInput = {}, options: FixhereOptions = {}) {
  return async (phase: string, context: unknown): Promise<NextConfigObject> => {
    const resolved = typeof config === "function" ? await config(phase, context) : config;
    if (phase !== DEV_PHASE) return resolved;
    const instance = await bridge(options);
    if (!instance) return resolved;
    return { ...resolved, env: { ...resolved.env, FIXHERE_SCRIPT_URL: instance.scriptUrl } };
  };
}

/** Next evaluates the config more than once per process; start the bridge once. */
function bridge(options: FixhereOptions): Promise<FixhereInstance | undefined> {
  const store = globalThis as typeof globalThis & {
    [SINGLETON]?: Promise<FixhereInstance | undefined>;
  };
  store[SINGLETON] ??= startFixhere({
    ...options,
    log: options.log ?? ((message) => console.log(`[fixhere] ${message}`)),
  }).catch((error: unknown) => {
    console.warn(`[fixhere] ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  return store[SINGLETON];
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Thread } from "@fixhere/protocol";
import { z } from "zod";

const StoreFile = z.object({ version: z.literal(1), threads: z.array(Thread) });

/**
 * Pins for one project, persisted to `.fixhere/threads.json` so they survive
 * bridge restarts and page reloads. Writes are debounced and atomic.
 */
export class ThreadStore {
  readonly path: string;
  #threads = new Map<string, Thread>();
  #writeTimer: ReturnType<typeof setTimeout> | undefined;
  #writing: Promise<void> = Promise.resolve();

  constructor(projectRoot: string) {
    this.path = join(projectRoot, ".fixhere", "threads.json");
  }

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return;
    }
    const parsed = StoreFile.safeParse(JSON.parse(raw));
    if (!parsed.success) return;
    for (const thread of parsed.data.threads) {
      // Anything mid-flight when the bridge stopped gets its real status from the provider.
      if (thread.status === "starting" && !thread.provider.threadId) {
        thread.status = "error";
        thread.statusDetail = "Bridge stopped before the thread was created";
      }
      this.#threads.set(thread.id, thread);
    }
  }

  list(): Thread[] {
    return [...this.#threads.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): Thread | undefined {
    return this.#threads.get(id);
  }

  findByProviderThread(providerId: string, providerThreadId: string): Thread | undefined {
    for (const thread of this.#threads.values()) {
      if (thread.provider.id === providerId && thread.provider.threadId === providerThreadId) {
        return thread;
      }
    }
    return undefined;
  }

  upsert(thread: Thread): void {
    this.#threads.set(thread.id, thread);
    this.#scheduleWrite();
  }

  delete(id: string): boolean {
    const deleted = this.#threads.delete(id);
    if (deleted) this.#scheduleWrite();
    return deleted;
  }

  async flush(): Promise<void> {
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer);
      this.#writeTimer = undefined;
      this.#write();
    }
    await this.#writing;
  }

  #scheduleWrite(): void {
    if (this.#writeTimer) return;
    this.#writeTimer = setTimeout(() => {
      this.#writeTimer = undefined;
      this.#write();
    }, 250);
  }

  #write(): void {
    const body = `${JSON.stringify({ version: 1, threads: this.list() }, null, 2)}\n`;
    this.#writing = this.#writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.tmp`;
      await writeFile(temp, body);
      await rename(temp, this.path);
    });
  }
}

import type { UpdateStatus } from '@tencildev/protocol';
import {
    handOffUpdate,
    type Installer,
    stageUpdate,
    takeUpdateFailure,
    type UpdatePlan,
} from '../service/self-update.ts';
import { compareVersions, latestVersion, updateChecksDisabled } from '../service/versions.ts';

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

export interface UpdateOptions {
    /** Ask the registry at all. Defaults to on, unless opted out (`updateChecksDisabled`). */
    check?: boolean;
    /** Registry base URL; defaults to `registryUrl()`. */
    registry?: string;
    /** Between checks; a failed one is retried sooner. Defaults to a day. */
    intervalMs?: number;
    /** Installs the new version (tests fake it); defaults to npm. */
    install?: Installer;
    /** Starts the helper that restarts the daemon (tests fake it). */
    handOff?: (plan: UpdatePlan) => void;
    /** How often to look again while threads are running. */
    idlePollMs?: number;
    /** How long to wait for the helper to replace this daemon before giving up. */
    restartTimeoutMs?: number;
}

export interface UpdaterOptions extends UpdateOptions {
    version: string;
    dataDir: string;
    port: number;
    node: string;
    /** The CLI this daemon runs from; without it, updates are left to the CLI. */
    cli?: string;
    flags: string[];
    /** Threads running across every project; a restart waits for none. */
    running: () => number | Promise<number>;
    onChange: (status: UpdateStatus) => void;
    log: (message: string) => void;
}

/**
 * Looks for new Tencil versions (on start, then about daily) and runs an
 * update started from the overlay: install it, wait until no thread is
 * running, then hand over to the helper that restarts the daemon on it.
 *
 * It waits rather than carrying threads across: Claude Code, Codex and ACP
 * agents run inside the daemon, so a restart would end their running turns.
 */
export class Updater {
    readonly #options: UpdaterOptions;
    #status: UpdateStatus = { state: 'idle' };
    #timer: ReturnType<typeof setTimeout> | undefined;
    #restartTimer: ReturnType<typeof setTimeout> | undefined;
    #disposed = false;

    constructor(options: UpdaterOptions) {
        this.#options = options;
        const failure = takeUpdateFailure(options.dataDir, options.port);
        if (failure) {
            this.#status = {
                state: 'failed',
                error: `Tencil ${failure.version} didn't start (${failure.error})`,
            };
        }
    }

    status(): UpdateStatus {
        return this.#status;
    }

    /** Check now and then on a timer. Never waits for the registry. */
    start(): void {
        const { check = !updateChecksDisabled() } = this.#options;
        if (check) void this.check();
    }

    async check(): Promise<void> {
        clearTimeout(this.#timer);
        const latest = await latestVersion({ registry: this.#options.registry, timeoutMs: 5_000 });
        if (this.#disposed) return;
        this.#timer = setTimeout(
            () => void this.check(),
            latest ? (this.#options.intervalMs ?? DAY_MS) : HOUR_MS,
        );
        this.#timer.unref?.();
        if (!latest) return;
        const newer = compareVersions(latest, this.#options.version) > 0 ? latest : undefined;
        if (newer === this.#status.latest) return;
        this.#set({ ...this.#status, latest: newer });
    }

    /** Move to the latest version. Progress and failures arrive through `onChange`. */
    async update(): Promise<void> {
        const { latest, state } = this.#status;
        if (state !== 'idle' && state !== 'failed') return;
        const { cli, dataDir, port, log } = this.#options;
        if (!latest) return this.#fail('Tencil is up to date');
        if (!cli) return this.#fail("This daemon wasn't started by the Tencil CLI");
        try {
            this.#set({ latest, state: 'installing' });
            log(`Installing Tencil ${latest}`);
            await stageUpdate(latest, { dataDir, port, install: this.#options.install });
            await this.#idle(latest);
            this.#set({ latest, state: 'restarting' });
            log(`Restarting on Tencil ${latest}`);
            (this.#options.handOff ?? (plan => handOffUpdate(plan, cli)))({
                version: latest,
                port,
                dataDir,
                node: this.#options.node,
                flags: this.#options.flags,
                previousCli: cli,
            });
            // The helper stops this daemon; if it's still here, the helper never ran.
            this.#restartTimer = setTimeout(
                () => this.#fail(`Tencil ${latest} didn't take over. See daemon.log.`),
                this.#options.restartTimeoutMs ?? 120_000,
            );
            this.#restartTimer.unref?.();
        } catch (error) {
            this.#fail(error instanceof Error ? error.message : String(error));
        }
    }

    dispose(): void {
        this.#disposed = true;
        clearTimeout(this.#timer);
        clearTimeout(this.#restartTimer);
    }

    async #idle(latest: string): Promise<void> {
        for (;;) {
            const running = await this.#options.running();
            if (!running) return;
            if (this.#status.state !== 'waiting' || this.#status.running !== running) {
                this.#set({ latest, state: 'waiting', running });
            }
            await new Promise(resolve => setTimeout(resolve, this.#options.idlePollMs ?? 1_000));
            if (this.#disposed) throw new Error('The daemon stopped');
        }
    }

    #fail(error: string): void {
        this.#options.log(`Update failed: ${error}`);
        this.#set({ latest: this.#status.latest, state: 'failed', error });
    }

    #set(status: UpdateStatus): void {
        this.#status = status;
        this.#options.onChange(status);
    }
}

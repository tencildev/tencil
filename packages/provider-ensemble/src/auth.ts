import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The tokens Ensemble gave Tencil, per Ensemble URL, readable only by this user. */
export class EnsembleCredentialStore {
    constructor(
        readonly path = join(
            process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
            'tencil',
            'ensemble-credentials.json',
        ),
    ) {}

    async get(baseUrl: string): Promise<string | undefined> {
        return (await this.#read())[new URL(baseUrl).origin];
    }

    async set(baseUrl: string, token: string): Promise<void> {
        const tokens = await this.#read();
        tokens[new URL(baseUrl).origin] = token;
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
        await chmod(this.path, 0o600);
    }

    async #read(): Promise<Record<string, string>> {
        try {
            return JSON.parse(await readFile(this.path, 'utf8')) as Record<string, string>;
        } catch {
            return {};
        }
    }
}

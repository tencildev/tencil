import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { withoutNpmEnv } from '@tencildev/provider-t3code';
import pc from 'picocolors';
import { newerDaemonLine } from '../cli/format.ts';
import { defaultDataDir } from '../daemon/thread-store.ts';
import { DEFAULT_CLOUD_URL } from '../integrations/cloud.ts';
import { ensureDaemon } from '../service/autostart.ts';
import { chooseProvider } from '../service/choose-provider.ts';
import type { DaemonCommand } from '../service/daemon-command.ts';
import { prepareProvider } from '../service/pairing.ts';
import { addTencilToBody, addVitePlugin, addWithTencil } from './codemods.ts';
import {
    detectFramework,
    detectPackageManager,
    type Framework,
    installCommand,
} from './detect-framework.ts';
import { diffLines, hunks } from './diff.ts';

export interface InitOptions {
    root: string;
    /** Apply without asking. */
    yes?: boolean;
    dryRun?: boolean;
    skipInstall?: boolean;
    skipPair?: boolean;
    /** Daemon port the overlay loads from. */
    port?: number;
    /** How to launch the daemon; when absent, init doesn't start it. */
    daemon?: DaemonCommand;
    /** Package spec to install, e.g. a local path before Tencil is published. */
    from?: string;
    t3Url?: string;
    /** Set up for Tencil Cloud previews: no daemon or pairing on this machine. */
    cloud?: boolean;
    log?: (message: string) => void;
}

export interface FileEdit {
    path: string;
    before: string;
    after: string;
}

export interface InitPlan {
    framework: Framework;
    edits: FileEdit[];
    manual: string[];
}

const SCRIPT_TAG = '<script src="http://localhost:4747/tencil.js" async></script>';
const NEXT_CONFIGS = ['next.config.ts', 'next.config.mts', 'next.config.mjs', 'next.config.js'];

/** Work out the edits without touching the disk. */
export async function planInit(root: string, options: { cloud?: boolean } = {}): Promise<InitPlan> {
    const framework = await detectFramework(root);
    const edits: FileEdit[] = [];
    const manual: string[] = [];

    const edit = async (
        path: string | undefined,
        codemod: (source: string) => string | null,
        instruction: string,
    ) => {
        if (!path) return void manual.push(instruction);
        const before = await readFile(path, 'utf8');
        if (/tencil\.js/.test(before)) {
            manual.push(
                `${relative(root, path)} loads tencil.js by hand. Replace that tag with \`<Tencil />\` from \`tencil/react\` so the bridge's port is picked up automatically.`,
            );
            return;
        }
        const after = codemod(before);
        if (after === null) manual.push(`${instruction} (in ${relative(root, path)})`);
        else if (after !== before) edits.push({ path, before, after });
    };

    switch (framework.kind) {
        case 'vite':
            await edit(
                framework.config,
                addVitePlugin,
                'Add `tencil()` from `tencil/vite` to `plugins`',
            );
            break;
        case 'next-app':
            await edit(
                framework.layout,
                addTencilToBody,
                'Render `<Tencil />` from `tencil/react` at the end of `<body>`',
            );
            break;
        case 'next-pages':
            await edit(
                framework.document,
                addTencilToBody,
                'Create pages/_document and render `<Tencil />` from `tencil/react` at the end of `<body>`',
            );
            break;
        case 'unknown':
            manual.push(`${framework.reason} Load this in development only: ${SCRIPT_TAG}`);
            break;
    }
    // Preview builds tag elements with their source through Next's bundler.
    if (options.cloud && (framework.kind === 'next-app' || framework.kind === 'next-pages')) {
        const config = NEXT_CONFIGS.map(name => join(root, name)).find(path => existsSync(path));
        if (config) {
            const before = await readFile(config, 'utf8');
            const after = addWithTencil(before);
            if (after === null) {
                manual.push(
                    `Wrap the exported config in \`withTencil()\` from \`tencil/next\` (in ${relative(root, config)})`,
                );
            } else if (after !== before) edits.push({ path: config, before, after });
        } else {
            manual.push('Create next.config.ts that exports `withTencil({})` from `tencil/next`');
        }
    }
    return { framework, edits, manual };
}

export async function runInit(options: InitOptions): Promise<void> {
    const log = options.log ?? console.log;
    const plan = await planInit(options.root, { cloud: options.cloud });
    log(`\n  ${pc.bold('Tencil')} ${pc.dim('·')} ${describe(plan.framework)}\n`);

    for (const edit of plan.edits) {
        log(`  ${pc.bold(relative(options.root, edit.path))}`);
        for (const line of hunks(diffLines(edit.before, edit.after))) {
            if (line === '…') log(pc.dim('    …'));
            else if (line.kind === 'add') log(pc.green(`  + ${line.text}`));
            else if (line.kind === 'remove') log(pc.red(`  - ${line.text}`));
            else log(pc.dim(`    ${line.text}`));
        }
        log('');
    }
    if (plan.edits.length === 0 && plan.manual.length === 0) {
        log(`  ${pc.green('✓')} Already set up.\n`);
    }
    for (const step of plan.manual) log(`  ${pc.yellow('!')} ${step}`);
    if (plan.manual.length) log('');
    if (options.dryRun) return;

    if (plan.edits.length && !options.yes) {
        if (!process.stdin.isTTY) {
            log(`  Re-run with ${pc.cyan('--yes')} to apply these changes.\n`);
            return;
        }
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(`  Apply these changes? ${pc.dim('(Y/n)')} `);
        rl.close();
        if (/^n/i.test(answer.trim())) return log('  Nothing changed.\n');
    }
    for (const edit of plan.edits) await writeFile(edit.path, edit.after);

    if (!options.skipInstall && plan.framework.kind !== 'unknown') {
        if (!(await hasDependency(options.root, 'tencil')) || options.from) install(options, log);
    }
    if (options.cloud) return logCloudSteps(plan.framework, log);

    let autostart = false;
    if (options.daemon) {
        const result = await ensureDaemon(options.daemon, defaultDataDir());
        autostart = result.autostart;
        log(
            result.newer
                ? newerDaemonLine(result.newer, options.daemon.port)
                : `  ${pc.green('✓')} Tencil ${result.status === 'running' ? 'is running' : result.status} on port ${options.daemon.port}.`,
        );
    }
    if (!options.skipPair) {
        const provider = await chooseProvider({ yes: options.yes, t3Url: options.t3Url, log });
        await prepareProvider(provider, options.t3Url, log);
    }

    log(`  ${pc.green('✓')} Done. Start your dev server and press ${pc.bold('C')} on the page.`);
    if (options.daemon && !autostart) log(pc.dim('    Start Tencil at login: npx tencil setup'));
    log('');
}

/** What's left to do in Tencil Cloud and the host once the code is in place. */
function logCloudSteps(framework: Framework, log: (message: string) => void): void {
    const env = pc.cyan('TENCIL_CLOUD=<project key>');
    log(
        `  ${pc.green('✓')} The overlay loads from Tencil Cloud on preview builds that set ${env}.`,
    );
    log(`    1. Create a project at ${pc.cyan(DEFAULT_CLOUD_URL)} and copy its key.`);
    log(
        `    2. Add ${env} to your host's ${pc.bold('Preview')} environment only (Vercel: Settings → Environment Variables).`,
    );
    log('    3. Redeploy a preview. Production deployments never load the overlay.');
    if (framework.kind === 'next-app' || framework.kind === 'next-pages') {
        log(
            pc.dim(
                '    Keep <Tencil /> in a server component: it reads TENCIL_CLOUD when the page renders.',
            ),
        );
    }
    log('');
}

/** Already a dependency (and no other package asked for with `--from`)? */
async function hasDependency(root: string, name: string): Promise<boolean> {
    try {
        const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
    } catch {
        return false;
    }
}

function install(options: InitOptions, log: (message: string) => void): void {
    const manager = detectPackageManager(options.root);
    const [command, args] = installCommand(manager, options.from ?? 'tencil');
    log(`  ${pc.dim(`$ ${command} ${args.join(' ')}`)}`);
    const result = spawnSync(command, args, {
        cwd: options.root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: withoutNpmEnv(),
    });
    if (result.status !== 0) {
        log(`  ${pc.yellow('!')} Install failed; run it yourself: ${command} ${args.join(' ')}\n`);
    }
}

function describe(framework: Framework): string {
    switch (framework.kind) {
        case 'next-app':
            return 'Next.js (app router)';
        case 'next-pages':
            return 'Next.js (pages router)';
        case 'vite':
            return 'Vite';
        default:
            return 'framework not detected';
    }
}

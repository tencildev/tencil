import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import { defaultDataDir } from '../daemon/thread-store.ts';
import { ensureDaemon } from '../service/autostart.ts';
import { chooseProvider } from '../service/choose-provider.ts';
import type { DaemonCommand } from '../service/daemon-command.ts';
import { prepareProvider } from '../service/pairing.ts';
import { addTencilToBody, addVitePlugin, renameFromFixhere, usesFixhere } from './codemods.ts';
import {
    detectFramework,
    detectPackageManager,
    type Framework,
    installCommand,
    uninstallCommand,
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

/** Work out the edits without touching the disk. */
export async function planInit(root: string): Promise<InitPlan> {
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
        if (usesFixhere(before)) {
            edits.push({ path, before, after: renameFromFixhere(before) });
            return;
        }
        if (/(?:tencil|fixhere)\.js/.test(before)) {
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
    return { framework, edits, manual };
}

export async function runInit(options: InitOptions): Promise<void> {
    const log = options.log ?? console.log;
    const plan = await planInit(options.root);
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
        // Tencil was called Fixhere up to 0.2.0; its package has nothing left to do here.
        if (await hasDependency(options.root, 'fixhere')) uninstall(options, 'fixhere', log);
    }
    let autostart = false;
    if (options.daemon) {
        const result = await ensureDaemon(options.daemon, defaultDataDir());
        autostart = result.autostart;
        log(
            `  ${pc.green('✓')} Tencil ${result.status === 'running' ? 'is running' : result.status} on port ${options.daemon.port}.`,
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

/** Already a dependency (and no other package asked for with `--from`)? */
async function hasDependency(root: string, name: string): Promise<boolean> {
    try {
        const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
    } catch {
        return false;
    }
}

function uninstall(options: InitOptions, name: string, log: (message: string) => void): void {
    const [command, args] = uninstallCommand(detectPackageManager(options.root), name);
    log(`  ${pc.dim(`$ ${command} ${args.join(' ')}`)}`);
    spawnSync(command, args, {
        cwd: options.root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
}

function install(options: InitOptions, log: (message: string) => void): void {
    const manager = detectPackageManager(options.root);
    const [command, args] = installCommand(manager, options.from ?? 'tencil');
    log(`  ${pc.dim(`$ ${command} ${args.join(' ')}`)}`);
    const result = spawnSync(command, args, {
        cwd: options.root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
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

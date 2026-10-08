import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import { defaultDataDir } from '../daemon/thread-store.ts';
import { ensureDaemon } from '../service/autostart.ts';
import type { DaemonCommand } from '../service/daemon-command.ts';
import { pairWithLocalT3 } from '../service/pairing.ts';
import { addFixhereToBody, addVitePlugin } from './codemods.ts';
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
    /** Package spec to install, e.g. a local path before Fixhere is published. */
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

const SCRIPT_TAG = '<script src="http://localhost:4747/fixhere.js" async></script>';

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
        if (/fixhere\.js/.test(before)) {
            manual.push(
                `${relative(root, path)} loads fixhere.js by hand. Replace that tag with \`<Fixhere />\` from \`fixhere/react\` so the bridge's port is picked up automatically.`,
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
                'Add `fixhere()` from `fixhere/vite` to `plugins`',
            );
            break;
        case 'next-app':
            await edit(
                framework.layout,
                addFixhereToBody,
                'Render `<Fixhere />` from `fixhere/react` at the end of `<body>`',
            );
            break;
        case 'next-pages':
            await edit(
                framework.document,
                addFixhereToBody,
                'Create pages/_document and render `<Fixhere />` from `fixhere/react` at the end of `<body>`',
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
    log(`\n  ${pc.bold('Fixhere')} ${pc.dim('·')} ${describe(plan.framework)}\n`);

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

    if (!options.skipInstall && plan.framework.kind !== 'unknown') install(options, log);
    let autostart = false;
    if (options.daemon) {
        const result = await ensureDaemon(options.daemon, defaultDataDir());
        autostart = result.autostart;
        log(
            `  ${pc.green('✓')} Fixhere ${result.status === 'running' ? 'is running' : result.status} on port ${options.daemon.port}.`,
        );
    }
    if (!options.skipPair) await pairWithLocalT3(options.t3Url, log);

    log(`  ${pc.green('✓')} Done. Start your dev server and press ${pc.bold('C')} on the page.`);
    if (!autostart) log(pc.dim('    Start Fixhere at login: npx fixhere setup'));
    log('');
}

function install(options: InitOptions, log: (message: string) => void): void {
    const manager = detectPackageManager(options.root);
    const [command, args] = installCommand(manager, options.from ?? 'fixhere');
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

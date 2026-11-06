import type { CodexPermissions } from '@tencildev/provider-codex';

export const RUNTIME_MODES = ['approval-required', 'auto-accept-edits', 'auto', 'full-access'];
/** Flags the background daemon and the login service inherit from `start`. */
const DAEMON_FLAGS = [
    't3-url',
    'model',
    'runtime-mode',
    'listen',
    'allow-origin',
    'no-create-project',
];

export function forwardedFlags(values: Record<string, unknown>): string[] {
    const args: string[] = [];
    for (const flag of DAEMON_FLAGS) {
        const value = values[flag];
        if (value === true) args.push(`--${flag}`);
        else if (typeof value === 'string') args.push(`--${flag}`, value);
        else if (Array.isArray(value)) for (const v of value) args.push(`--${flag}`, String(v));
    }
    return args;
}

/** Tencil's runtime modes in Claude Code's terms. */
const PERMISSION_MODES = {
    'approval-required': 'default',
    'auto-accept-edits': 'acceptEdits',
    auto: 'auto',
    'full-access': 'bypassPermissions',
} as const;

export function permissionModeFor(runtimeMode: string | undefined) {
    return runtimeMode ? PERMISSION_MODES[runtimeMode as keyof typeof PERMISSION_MODES] : undefined;
}

/**
 * Tencil's runtime modes in Codex's terms. With `never` Codex has nobody to ask:
 * what the sandbox blocks is refused and Codex is told so. In `auto` its own
 * reviewer decides what may leave the sandbox, like Claude Code's auto mode.
 */
const CODEX_PERMISSIONS: Record<string, CodexPermissions> = {
    'approval-required': { sandbox: 'read-only', approvalPolicy: 'never' },
    'auto-accept-edits': { sandbox: 'workspace-write', approvalPolicy: 'never' },
    auto: {
        sandbox: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
    },
    'full-access': { sandbox: 'danger-full-access', approvalPolicy: 'never' },
};

export function codexPermissionsFor(runtimeMode: string | undefined) {
    return runtimeMode ? CODEX_PERMISSIONS[runtimeMode] : undefined;
}

/**
 * `--model` is one flag for every agent, and the name says whose it is:
 * `instance:model` is T3 Code's, an OpenAI model is Codex's, the rest Claude Code's.
 */
export function modelFlagFor(value: string | undefined): {
    t3?: ReturnType<typeof parseModel>;
    claudeCode?: string;
    codex?: string;
} {
    if (!value) return {};
    if (value.includes(':')) return { t3: parseModel(value) };
    return /^(gpt-|o\d|codex)/i.test(value) ? { codex: value } : { claudeCode: value };
}

export function parseModel(value: string | undefined) {
    if (!value) return undefined;
    const [instanceId, ...model] = value.split(':');
    if (!instanceId || model.length === 0) throw new Error('--model must look like instance:model');
    return { instanceId, model: model.join(':') };
}

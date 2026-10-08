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

/** Fixhere's runtime modes in Claude Code's terms. */
const PERMISSION_MODES = {
    'approval-required': 'default',
    'auto-accept-edits': 'acceptEdits',
    auto: 'auto',
    'full-access': 'bypassPermissions',
} as const;

export function permissionModeFor(runtimeMode: string | undefined) {
    return runtimeMode ? PERMISSION_MODES[runtimeMode as keyof typeof PERMISSION_MODES] : undefined;
}

export function parseModel(value: string | undefined) {
    if (!value) return undefined;
    const [instanceId, ...model] = value.split(':');
    if (!instanceId || model.length === 0) throw new Error('--model must look like instance:model');
    return { instanceId, model: model.join(':') };
}

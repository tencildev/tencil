/** How to launch the daemon process (background start or login service). */
export interface DaemonCommand {
    /** Absolute path of the node binary. */
    node: string;
    /** Absolute path of the fixhere CLI entry. */
    cli: string;
    port: number;
    /** Extra daemon flags (model, runtime mode, …) passed through from `start`. */
    args?: string[];
}

export function daemonArgs(command: DaemonCommand): string[] {
    return [command.cli, 'daemon', '--port', String(command.port), ...(command.args ?? [])];
}

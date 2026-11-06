import type { RuntimeMode } from '@tencildev/provider-t3code';
import pc from 'picocolors';
import type { ProviderName } from '../../daemon/agents.ts';
import { startDaemon } from '../../daemon/server.ts';
import { time } from '../format.ts';
import {
    codexPermissionsFor,
    forwardedFlags,
    modelFlagFor,
    permissionModeFor,
} from '../options.ts';

export async function runDaemon(
    values: Record<string, unknown>,
    port: number,
    provider: ProviderName | undefined,
    t3Url: string | undefined,
    runtimeMode: RuntimeMode | undefined,
    cli: string,
): Promise<void> {
    const model = modelFlagFor(values.model as string | undefined);
    const daemon = await startDaemon({
        port,
        listen: values.listen as string[] | undefined,
        allowedOrigins: values['allow-origin'] as string[] | undefined,
        provider,
        claudeCode: {
            model: model.claudeCode,
            permissionMode: permissionModeFor(runtimeMode),
        },
        codex: {
            model: model.codex,
            permissions: codexPermissionsFor(runtimeMode),
        },
        t3: {
            url: t3Url,
            modelSelection: model.t3,
            runtimeMode,
            createProjectIfMissing: !values['no-create-project'],
        },
        log: message => console.log(`${pc.dim(time())} ${message}`),
        flags: forwardedFlags(values),
        cli,
    }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            throw new Error(
                `Port ${port} is in use. Is Tencil already running? Try \`tencil status\`.`,
            );
        }
        throw error;
    });
    const shutdown = async () => {
        await daemon.close();
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

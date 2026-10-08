import type { RuntimeMode } from '@tencil/provider-t3code';
import pc from 'picocolors';
import type { ProviderName } from '../../daemon/agents.ts';
import { startDaemon } from '../../daemon/server.ts';
import { time } from '../format.ts';
import { forwardedFlags, parseModel, permissionModeFor } from '../options.ts';

export async function runDaemon(
    values: Record<string, unknown>,
    port: number,
    provider: ProviderName | undefined,
    t3Url: string | undefined,
    runtimeMode: RuntimeMode | undefined,
): Promise<void> {
    // T3 Code models read `instance:model`; anything else is a Claude Code model.
    const model = values.model as string | undefined;
    const t3Model = model?.includes(':') ? model : undefined;
    const daemon = await startDaemon({
        port,
        listen: values.listen as string[] | undefined,
        allowedOrigins: values['allow-origin'] as string[] | undefined,
        provider,
        claudeCode: {
            model: t3Model ? undefined : model,
            permissionMode: permissionModeFor(runtimeMode),
        },
        t3: {
            url: t3Url,
            modelSelection: parseModel(t3Model),
            runtimeMode,
            createProjectIfMissing: !values['no-create-project'],
        },
        log: message => console.log(`${pc.dim(time())} ${message}`),
        flags: forwardedFlags(values),
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

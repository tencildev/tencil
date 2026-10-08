import type { RuntimeMode } from '@fixhere/provider-t3code';
import pc from 'picocolors';
import { startDaemon } from '../../daemon/server.ts';
import { time } from '../format.ts';
import { parseModel } from '../options.ts';

export async function runDaemon(
    values: Record<string, unknown>,
    port: number,
    t3Url: string | undefined,
    runtimeMode: RuntimeMode | undefined,
): Promise<void> {
    const daemon = await startDaemon({
        port,
        listen: values.listen as string[] | undefined,
        allowedOrigins: values['allow-origin'] as string[] | undefined,
        t3: {
            url: t3Url,
            modelSelection: parseModel(values.model as string | undefined),
            runtimeMode,
            createProjectIfMissing: !values['no-create-project'],
        },
        log: message => console.log(`${pc.dim(time())} ${message}`),
    }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            throw new Error(
                `Port ${port} is in use. Is Fixhere already running? Try \`fixhere status\`.`,
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

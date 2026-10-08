import {
    CredentialStore,
    createLocalPairingCode,
    DEFAULT_T3_URL,
    exchangePairingCredential,
} from '@fixhere/provider-t3code';
import pc from 'picocolors';

/** Pair with the local T3 Code now, so the first page load is ready to go. */
export async function pairWithLocalT3(
    t3Url: string | undefined,
    log: (message: string) => void,
): Promise<void> {
    const store = new CredentialStore();
    const baseUrl = t3Url ?? (await store.lastBaseUrl()) ?? DEFAULT_T3_URL;
    if (await store.get(baseUrl)) return log(`  ${pc.green('✓')} Paired with T3 Code.`);
    const code = await createLocalPairingCode(baseUrl).catch(() => undefined);
    if (!code) {
        log(
            `  ${pc.yellow('!')} T3 Code isn't running, so pairing is skipped. Fixhere pairs on its own once it is.`,
        );
        return;
    }
    try {
        await store.set(baseUrl, await exchangePairingCredential({ baseUrl, credential: code }));
        log(`  ${pc.green('✓')} Paired with T3 Code at ${baseUrl}`);
    } catch (error) {
        log(`  ${pc.yellow('!')} ${error instanceof Error ? error.message : String(error)}`);
    }
}

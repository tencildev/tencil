import { createInterface } from 'node:readline/promises';
import {
    CredentialStore,
    createLocalPairingCode,
    DEFAULT_T3_URL,
    exchangePairingCredential,
    parsePairingInput,
} from '@tencildev/provider-t3code';
import pc from 'picocolors';

export async function connect(input: string | undefined, t3Url: string | undefined): Promise<void> {
    const store = new CredentialStore();
    const baseUrl = t3Url ?? (await store.lastBaseUrl()) ?? DEFAULT_T3_URL;
    let pairing = input;
    if (!pairing) {
        console.log(`\n  ${pc.dim('Creating a pairing code on the local T3 Code…')}`);
        pairing = await createLocalPairingCode(baseUrl).catch(() => undefined);
    }
    if (!pairing) {
        console.log(`
  Create a pairing link in ${pc.bold('T3 Code → Settings → Connections')}
  (or run ${pc.cyan('npx t3 pair')}) and paste it below.
`);
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        pairing = await rl.question('  Pairing link or code: ');
        rl.close();
    }
    const target = parsePairingInput(pairing, baseUrl);
    const credential = await exchangePairingCredential(target);
    await store.set(target.baseUrl, credential);
    console.log(
        `\n  ${pc.green('✓')} Paired with T3 Code at ${target.baseUrl} ${pc.dim(`(valid until ${new Date(credential.expiresAt).toLocaleDateString()})`)}\n`,
    );
}

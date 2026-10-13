import pc from 'picocolors';
import { z } from 'zod';
import {
    CloudCredentials,
    DEFAULT_CLOUD_URL,
    fetchCliClient,
    parseTokenResponse,
} from '../../cloud/credentials.ts';

const DeviceCode = z.object({
    device_code: z.string(),
    user_code: z.string(),
    verification_uri: z.string(),
    verification_uri_complete: z.string().optional(),
    expires_in: z.number(),
    interval: z.number().default(5),
});

/**
 * Sign this machine in to Tencil Cloud with the device flow: approve the code
 * in a browser (any device), and the daemon can use Tencil Cloud as a provider.
 */
export async function login(
    cloudUrl: string | undefined,
    options: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
    const fetchImpl = options.fetch ?? fetch;
    const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const credentials = new CloudCredentials({ fetch: fetchImpl });
    const url = (
        cloudUrl ??
        process.env.TENCIL_CLOUD_URL ??
        (await credentials.load())?.url ??
        DEFAULT_CLOUD_URL
    ).replace(/\/+$/, '');
    const client = await fetchCliClient(url, fetchImpl);

    const started = await fetchImpl(client.deviceCodeUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: new URLSearchParams({ client_id: client.clientId, scope: client.scope }),
    });
    if (!started.ok) throw new Error(`Tencil Cloud refused the sign-in (${started.status})`);
    const device = DeviceCode.parse(await started.json());

    console.log(`
  Open ${pc.cyan(device.verification_uri_complete ?? device.verification_uri)}
  and approve the code ${pc.bold(device.user_code)}.
`);
    let interval = device.interval * 1000;
    const deadline = Date.now() + device.expires_in * 1000;
    while (Date.now() < deadline) {
        await sleep(interval);
        const response = await fetchImpl(client.tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                device_code: device.device_code,
                client_id: client.clientId,
            }),
        });
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.ok) {
            await credentials.save(url, parseTokenResponse(body));
            console.log(`  ${pc.green('✓')} Signed in to Tencil Cloud at ${url}.
  Restart the daemon (${pc.cyan('npx tencil stop && npx tencil start')}) and pick
  ${pc.bold('Tencil Cloud')} in a project's settings in the overlay.
`);
            return;
        }
        if (body.error === 'authorization_pending') continue;
        if (body.error === 'slow_down') {
            interval += 5000;
            continue;
        }
        if (body.error === 'access_denied') throw new Error('The sign-in was denied');
        throw new Error(`Tencil Cloud refused the sign-in (${body.error ?? response.status})`);
    }
    throw new Error('The code expired before it was approved. Run `npx tencil login` again.');
}

export async function logout(): Promise<void> {
    await new CloudCredentials().clear();
    console.log(`\n  ${pc.green('✓')} Signed out of Tencil Cloud on this machine.\n`);
}

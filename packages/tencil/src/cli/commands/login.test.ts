import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudCredentials } from '../../cloud/credentials.ts';
import { login } from './login.ts';

const CLOUD = 'https://cloud.example';

describe('tencil login', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('waits for the device code to be approved, then saves the tokens for this user only', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'tencil-login-'));
        vi.stubEnv('XDG_CONFIG_HOME', dataDir);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        let polls = 0;
        const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url === `${CLOUD}/api/cli`) {
                return Response.json({
                    clientId: 'cli-client',
                    // Another host than the one we asked: the codes still go to CLOUD.
                    deviceCodeUrl: 'https://elsewhere.example/oauth/device/code',
                    tokenUrl: 'https://elsewhere.example/oauth/token',
                    scope: 'cli',
                });
            }
            const body = new URLSearchParams(String(init?.body));
            if (url === `${CLOUD}/oauth/device/code`) {
                expect(Object.fromEntries(body)).toEqual({ client_id: 'cli-client', scope: 'cli' });
                return Response.json({
                    device_code: 'device-1',
                    user_code: 'ABCD-EFGH',
                    verification_uri: `${CLOUD}/oauth/device`,
                    expires_in: 600,
                    interval: 5,
                });
            }
            expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
            polls++;
            if (polls === 1)
                return Response.json({ error: 'authorization_pending' }, { status: 400 });
            return Response.json({
                access_token: 'access-1',
                refresh_token: 'refresh-1',
                expires_in: 7200,
            });
        }) as typeof fetch;

        await login(CLOUD, { fetch: fetchImpl, sleep: async () => {} });

        expect(polls).toBe(2);
        const credentials = new CloudCredentials({ path: join(dataDir, 'tencil', 'cloud.json') });
        expect(await credentials.load()).toMatchObject({
            url: CLOUD,
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
        });
        expect(statSync(credentials.path).mode & 0o777).toBe(0o600);
    });
});

import { describe, expect, it } from 'vitest';
import { withoutNpmEnv } from './auth.ts';

describe('withoutNpmEnv', () => {
    it("drops what an outer npx passes down but keeps the user's own settings", () => {
        expect(
            withoutNpmEnv({
                PATH: '/usr/bin',
                npm_config_package: '/tmp/tencil.tgz',
                npm_config_yes: 'true',
                npm_command: 'exec',
                NPM_CONFIG_REGISTRY: 'https://registry.example',
            }),
        ).toEqual({ PATH: '/usr/bin', NPM_CONFIG_REGISTRY: 'https://registry.example' });
    });
});

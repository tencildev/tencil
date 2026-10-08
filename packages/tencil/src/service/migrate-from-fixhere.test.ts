import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { carriesOver, fixhereServiceNames, migrateFromFixhere } from './migrate-from-fixhere.ts';

describe('moving a Fixhere install over', () => {
    it("copies pins, pairing and settings, but not Fixhere's runtime copy or log", async () => {
        const config = mkdtempSync(join(tmpdir(), 'tencil-migrate-'));
        const old = join(config, 'fixhere');
        mkdirSync(join(old, 'projects'), { recursive: true });
        mkdirSync(join(old, 'runtime', 'node_modules'), { recursive: true });
        writeFileSync(join(old, 'credentials.json'), '{"token":"t"}');
        writeFileSync(join(old, 'projects', 'site-abc.json'), '{"threads":[]}');
        writeFileSync(join(old, 'daemon.log'), 'old log');

        const lines: string[] = [];
        // A port nothing listens on, so no real service or daemon is involved.
        await migrateFromFixhere(48_731, join(config, 'tencil'), line => lines.push(line));

        const moved = join(config, 'tencil');
        expect(readFileSync(join(moved, 'credentials.json'), 'utf8')).toBe('{"token":"t"}');
        expect(existsSync(join(moved, 'projects', 'site-abc.json'))).toBe(true);
        expect(existsSync(join(moved, 'runtime'))).toBe(false);
        expect(existsSync(join(moved, 'daemon.log'))).toBe(false);
        expect(lines.join('\n')).toMatch(/Moved Fixhere over to Tencil/);

        // Once moved, it stays out of the way.
        writeFileSync(join(old, 'credentials.json'), '{"token":"newer"}');
        const again: string[] = [];
        await migrateFromFixhere(48_731, moved, line => again.push(line));
        expect(readFileSync(join(moved, 'credentials.json'), 'utf8')).toBe('{"token":"t"}');
        expect(again).toEqual([]);
    });

    it("knows Fixhere's service names and which files carry over", () => {
        expect(fixhereServiceNames(4747)).toEqual([
            { label: 'dev.fixhere.daemon', unit: 'fixhere.service', task: 'Fixhere' },
        ]);
        expect(fixhereServiceNames(4790)).toHaveLength(2);
        expect(carriesOver('/c/fixhere/projects')).toBe(true);
        expect(carriesOver('/c/fixhere/runtime')).toBe(false);
        expect(carriesOver('/c/fixhere/runtime-4790')).toBe(false);
        expect(carriesOver('/c/fixhere/daemon.log')).toBe(false);
    });
});

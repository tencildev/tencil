import { describe, expect, it } from 'vitest';
import { nearestDock } from './dock.ts';

describe('nearestDock', () => {
    it.each([
        [100, 700, 'bottom-left'],
        [640, 790, 'bottom-center'],
        [1200, 700, 'bottom-right'],
        [100, 50, 'top-left'],
        [640, 10, 'top-center'],
        [1200, 100, 'top-right'],
    ] as const)('(%i, %i) → %s', (x, y, expected) => {
        expect(nearestDock(x, y, 1280, 800)).toBe(expected);
    });
});

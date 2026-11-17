import { describe, expect, it } from 'vitest';
import { acpPermissionsFor, codexPermissionsFor, modelFlagFor, RUNTIME_MODES } from './options.ts';

describe('runtime modes in Codex terms', () => {
    it('covers every mode, and leaves an unset one to the provider', () => {
        for (const mode of RUNTIME_MODES) expect(codexPermissionsFor(mode)).toBeDefined();
        expect(codexPermissionsFor(undefined)).toBeUndefined();
    });

    it('only leaves the sandbox on full access, or when Codex reviews it itself', () => {
        expect(codexPermissionsFor('full-access')).toEqual({
            sandbox: 'danger-full-access',
            approvalPolicy: 'never',
        });
        expect(codexPermissionsFor('auto')).toEqual({
            sandbox: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
        });
        expect(codexPermissionsFor('auto-accept-edits')).toEqual({
            sandbox: 'workspace-write',
            approvalPolicy: 'never',
        });
        expect(codexPermissionsFor('approval-required')).toEqual({
            sandbox: 'read-only',
            approvalPolicy: 'never',
        });
    });
});

describe('runtime modes for ACP agents', () => {
    it('covers every mode, and only allows commands on full access', () => {
        expect(RUNTIME_MODES.map(acpPermissionsFor)).toEqual([
            'read-only',
            'edits',
            'edits',
            'full-access',
        ]);
        expect(acpPermissionsFor(undefined)).toBeUndefined();
    });
});

describe('--model', () => {
    it('goes to the agent whose model it names', () => {
        expect(modelFlagFor(undefined)).toEqual({});
        expect(modelFlagFor('claudeAgent:claude-fable-5-1')).toEqual({
            t3: { instanceId: 'claudeAgent', model: 'claude-fable-5-1' },
        });
        expect(modelFlagFor('claude-opus-5-5')).toEqual({ claudeCode: 'claude-opus-5-5' });
        expect(modelFlagFor('opus')).toEqual({ claudeCode: 'opus' });
        for (const model of ['gpt-6.1-sol', 'o4-mini', 'codex-mini-latest']) {
            expect(modelFlagFor(model)).toEqual({ codex: model });
        }
    });
});

import type { ChangeSpan } from '@tencildev/protocol';

/**
 * What an agent changed in the project's work tree, for Git actions. The
 * bridge snapshots the work tree when a turn starts and ends; each pair is a
 * span. The daemon does it with Git; a host without one leaves it out, and
 * the overlay doesn't offer the setting.
 */
export interface ChangeTracker {
    /**
     * The work tree as it is now, including untracked files Git doesn't
     * ignore; undefined when the project isn't in a Git repository.
     */
    snapshot(): Promise<string | undefined>;
    /** The files the spans change, relative to the repository root. */
    files(spans: ChangeSpan[]): Promise<string[]>;
    /**
     * The commit HEAD points at; undefined before the first one. Commit asks
     * the pin's agent to commit, and HEAD moving tells that it did.
     */
    head(): Promise<string | undefined>;
    /** Undo the spans' edits in the work tree, keeping every other edit. */
    revert(spans: ChangeSpan[]): Promise<void>;
}

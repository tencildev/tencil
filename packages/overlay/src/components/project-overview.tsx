import type { ProjectSource } from '@tencildev/protocol';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isCloud, project, projectSource, send, switchChoices } from '../lib/connection.ts';

/** Keeps a path's leading slash in place in a right-to-left box (cut from the start). */
const LTR = '\u200e';

/**
 * The settings' start page: the project this page belongs to (name and folder
 * are in the page header), how Tencil matched it, and switching it.
 */
export function ProjectOverview() {
    const source = projectSource.value;
    return (
        <div class="settings-section overview">
            {source && !isCloud() ? (
                <Detection source={source} />
            ) : (
                <p class="settings-help">Pins on this page go to this project.</p>
            )}
        </div>
    );
}

/** How the page was matched to this project, and switching it to another. */
function Detection({ source }: { source: ProjectSource }) {
    const [choosing, setChoosing] = useState(false);
    const [query, setQuery] = useState('');
    const search = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (choosing) search.current?.focus();
    }, [choosing]);
    const picked = source.via === 'picked';
    const choices = switchChoices.value;
    const needle = query.trim().toLowerCase();
    const current = project.value?.root;
    const matches = (choices ?? []).filter(
        choice =>
            choice.root !== current &&
            (!needle ||
                choice.title.toLowerCase().includes(needle) ||
                choice.root.toLowerCase().includes(needle)),
    );
    const select = (root: string) => {
        send({ type: 'project.select', root });
        setChoosing(false);
        setQuery('');
    };

    return (
        <div class="overview-block">
            <p class="settings-label">Project detection</p>
            <div class="detection">
                <span class={`detection-badge${picked ? ' detection-picked' : ''}`}>
                    {picked ? 'Picked' : 'Automatic'}
                </span>
                <span class="settings-help detection-reason">{describeSource(source)}</span>
                <span class="detection-actions">
                    {source.detected && (
                        <button
                            type="button"
                            class="detection-button"
                            onClick={() => source.detected && select(source.detected.root)}
                        >
                            Use automatic
                        </button>
                    )}
                    <button
                        type="button"
                        class="detection-button"
                        aria-expanded={choosing}
                        onClick={() => {
                            if (!choosing) {
                                switchChoices.value = null;
                                send({ type: 'project.choices' });
                            }
                            setChoosing(!choosing);
                        }}
                    >
                        {choosing ? 'Cancel' : 'Change'}
                    </button>
                </span>
            </div>
            {choosing && (
                <div class="detection-picker">
                    <input
                        class="detection-search"
                        type="search"
                        placeholder="Search projects"
                        aria-label="Search projects"
                        ref={search}
                        value={query}
                        onInput={event => setQuery((event.target as HTMLInputElement).value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && matches[0]) select(matches[0].root);
                        }}
                    />
                    <div class="detection-list">
                        {choices === null ? (
                            <p class="settings-help">Looking for projects…</p>
                        ) : matches.length === 0 ? (
                            <p class="settings-help">
                                {needle
                                    ? `No project matches “${query.trim()}”.`
                                    : 'No other projects found.'}
                            </p>
                        ) : (
                            matches.map(choice => (
                                <button
                                    key={choice.root}
                                    type="button"
                                    class="detection-option"
                                    title={choice.root}
                                    onClick={() => select(choice.root)}
                                >
                                    <span class="detection-option-name">{choice.title}</span>
                                    <span class="detection-option-root">{LTR + choice.root}</span>
                                </button>
                            ))
                        )}
                    </div>
                    <p class="settings-help">
                        Kept for this address while Tencil finds the same project here. When another
                        app takes the port, detection decides again.
                    </p>
                </div>
            )}
        </div>
    );
}

export function describeSource(source: ProjectSource): string {
    if (source.via === 'picked') {
        if (!source.detected)
            return "You picked it for this address: Tencil couldn't tell from the page.";
        const name = source.detected.root.split(/[\\/]/).filter(Boolean).pop();
        return `You picked it instead of ${name ?? 'the detected project'}.`;
    }
    switch (source.via) {
        case 'plugin':
            return 'The git repository the Vite or Next.js plugin passed along.';
        case 'port':
            return `The dev server listening on port ${source.port}.`;
        case 'docker':
            return `The Docker Compose project publishing port ${source.port}.`;
        default:
            return `The Ensemble thread whose dev server runs on port ${source.port}.`;
    }
}

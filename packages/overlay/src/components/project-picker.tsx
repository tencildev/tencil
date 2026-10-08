import { useState } from 'preact/hooks';
import { projectChoices, projectChoicesHint, send } from '../lib/connection.ts';

/** Shown when the daemon couldn't match this page to a project. */
export function ProjectPicker() {
    const [query, setQuery] = useState('');
    const choices = projectChoices.value ?? [];
    const needle = query.trim().toLowerCase();
    const matches = needle
        ? choices.filter(
              choice =>
                  choice.title.toLowerCase().includes(needle) ||
                  choice.root.toLowerCase().includes(needle),
          )
        : choices;
    const select = (root: string) => send({ type: 'project.select', root });

    return (
        <div class="project-picker">
            <p class="project-picker-title">Which project is this page?</p>
            {choices.length === 0 ? (
                <p class="project-picker-empty">
                    {projectChoicesHint.value ?? 'No projects found.'}
                </p>
            ) : (
                <>
                    <input
                        class="project-picker-search"
                        type="search"
                        placeholder="Search projects"
                        aria-label="Search projects"
                        // biome-ignore lint/a11y/noAutofocus: the picker exists to be typed into.
                        autoFocus
                        value={query}
                        onInput={event => setQuery((event.target as HTMLInputElement).value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && matches[0]) select(matches[0].root);
                        }}
                    />
                    <div class="project-picker-list">
                        {matches.length === 0 && (
                            <p class="project-picker-empty">No project matches “{query.trim()}”.</p>
                        )}
                        {matches.map(choice => (
                            <button
                                key={choice.root}
                                type="button"
                                class="project-picker-option"
                                title={choice.root}
                                onClick={() => select(choice.root)}
                            >
                                <span class="project-picker-name">{choice.title}</span>
                                <span class="project-picker-root">{choice.root}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

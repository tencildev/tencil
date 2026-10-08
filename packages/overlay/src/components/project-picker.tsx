import { projectChoices, send } from '../lib/connection.ts';

/** Shown when the daemon couldn't match this page to a project. */
export function ProjectPicker() {
    const choices = projectChoices.value ?? [];
    return (
        <div class="project-picker">
            <p class="project-picker-title">Which project is this page?</p>
            {choices.length === 0 ? (
                <p class="project-picker-empty">
                    No T3 Code projects found. Pair with T3 Code first: npx fixhere connect
                </p>
            ) : (
                <div class="project-picker-list">
                    {choices.map(choice => (
                        <button
                            key={choice.root}
                            type="button"
                            class="project-picker-option"
                            title={choice.root}
                            onClick={() => send({ type: 'project.select', root: choice.root })}
                        >
                            <span class="project-picker-name">{choice.title}</span>
                            <span class="project-picker-root">{choice.root}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

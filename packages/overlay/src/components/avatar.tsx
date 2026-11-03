import { useState } from 'preact/hooks';
import { initials } from '../lib/comments.ts';

/** A person's picture, or their initials when there's none (or it fails to load). */
export function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
    const [failed, setFailed] = useState(false);
    if (avatarUrl && !failed) {
        return (
            <img
                class="avatar"
                src={avatarUrl}
                alt=""
                referrerpolicy="no-referrer"
                onError={() => setFailed(true)}
            />
        );
    }
    return (
        <span class="avatar avatar-initials" aria-hidden="true">
            {initials(name)}
        </span>
    );
}

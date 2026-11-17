import { effect, type Signal, signal } from '@preact/signals';
import type { Preferences } from '@tencildev/protocol';
import { preferences, send } from './connection.ts';

type Key = 'theme';
type Value<K extends Key> = NonNullable<Preferences[K]>;

/**
 * One of the person's preferences: saved by the daemon for every project on
 * this machine, with a copy in the browser to draw the first frame right and
 * for Tencil Cloud. The daemon's value wins; without one yet, this browser's
 * becomes the machine's.
 */
export function preference<K extends Key>(options: {
    key: K;
    storageKey: string;
    fallback: Value<K>;
    parse: (stored: string) => Value<K> | undefined;
    serialize?: (value: Value<K>) => string;
}): [Signal<Value<K>>, (next: Value<K>) => void] {
    const { key, storageKey, fallback, parse, serialize = String } = options;
    const stored = () => {
        try {
            return localStorage.getItem(storageKey);
        } catch {
            return null;
        }
    };
    const raw = stored();
    const value = signal<Value<K>>((raw === null ? undefined : parse(raw)) ?? fallback);
    const apply = (next: Value<K>) => {
        value.value = next;
        try {
            localStorage.setItem(storageKey, serialize(next));
        } catch {
            // Storage can be blocked; the choice just won't persist.
        }
    };
    const save = (next: Value<K>) =>
        send({ type: 'preferences.update', preferences: { [key]: next } as Preferences });

    effect(() => {
        const saved = preferences.value;
        if (!saved) return;
        const remote = saved[key] as Value<K> | undefined;
        if (remote !== undefined) {
            if (remote !== value.peek()) apply(remote);
        } else if (stored() !== null) {
            save(value.peek());
        }
    });

    return [
        value,
        next => {
            apply(next);
            save(next);
        },
    ];
}

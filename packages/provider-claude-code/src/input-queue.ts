/** An async iterable fed by `push`; the Agent SDK reads a session's user messages from it. */
export class InputQueue<T> implements AsyncIterable<T> {
    readonly #items: T[] = [];
    #waiting: ((result: IteratorResult<T>) => void) | undefined;
    #closed = false;

    push(item: T): void {
        if (this.#closed) throw new Error('Input is closed');
        const waiting = this.#waiting;
        if (waiting) {
            this.#waiting = undefined;
            waiting({ value: item, done: false });
        } else {
            this.#items.push(item);
        }
    }

    close(): void {
        this.#closed = true;
        this.#waiting?.({ value: undefined, done: true });
        this.#waiting = undefined;
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: () => {
                const item = this.#items.shift();
                if (item !== undefined) return Promise.resolve({ value: item, done: false });
                if (this.#closed) return Promise.resolve({ value: undefined, done: true });
                return new Promise(resolve => {
                    this.#waiting = resolve;
                });
            },
        };
    }
}

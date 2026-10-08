/** Poll until `check` returns a truthy value or throw after `timeoutMs`. */
export async function waitFor<T>(
    check: () => T | undefined | null | false | Promise<T | undefined | null | false>,
    { timeoutMs = 3000, intervalMs = 10, message = 'condition' } = {},
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
        try {
            const result = await check();
            if (result) return result;
        } catch (error) {
            last = error;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timed out waiting for ${message}${last ? `: ${String(last)}` : ''}`);
}

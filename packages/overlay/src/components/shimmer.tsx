/** Per-character color wave; screen readers get the plain label. */
export function Shimmer({ text }: { text: string }) {
    const characters = [...text];
    return (
        <span class="shimmer">
            <span class="sr-only">{text}</span>
            {characters.map((character, index) => (
                <span
                    key={index}
                    aria-hidden="true"
                    style={{ '--i': index, '--n': characters.length }}
                >
                    {character}
                </span>
            ))}
        </span>
    );
}

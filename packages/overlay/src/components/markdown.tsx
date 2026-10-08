import type { ComponentChildren } from 'preact';

/** Only the newest words are wrapped in animated spans; older text stays plain. */
const ANIMATED_TAIL = 48;

/**
 * Just enough Markdown for agent replies: fenced code, lists, headings,
 * paragraphs, inline code, bold and links. Builds VDOM (never innerHTML),
 * so model output can't inject markup into the host page.
 *
 * With `animate`, words blur in as they stream. Words are keyed by their
 * position in the message, so text that already arrived never replays.
 */
export function Markdown({ text, animate = false }: { text: string; animate?: boolean }) {
    const words = animate ? countWords(text) : 0;
    const cursor: WordCursor = {
        index: 0,
        animateFrom: animate ? words - ANIMATED_TAIL : Number.POSITIVE_INFINITY,
    };
    return <div class="md">{blocks(text, cursor)}</div>;
}

interface WordCursor {
    index: number;
    animateFrom: number;
}

function blocks(text: string, cursor: WordCursor): ComponentChildren[] {
    const out: ComponentChildren[] = [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    let key = 0;

    while (i < lines.length) {
        const line = lines[i]!;

        const fence = line.match(/^\s*```(\w*)/);
        if (fence) {
            const body: string[] = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
            i++;
            // Code never animates, but its words still count toward stable positions.
            cursor.index += countWords(body.join('\n'));
            out.push(
                <pre key={key++}>
                    <code>{body.join('\n')}</code>
                </pre>,
            );
            continue;
        }

        if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
            const ordered = /^\s*\d+\./.test(line);
            const items: string[] = [];
            while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
                items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, ''));
            }
            const children = items.map((item, index) => (
                <li key={index}>{inline(item, cursor)}</li>
            ));
            out.push(ordered ? <ol key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>);
            continue;
        }

        const heading = line.match(/^#{1,6}\s+(.*)/);
        if (heading) {
            out.push(
                <p key={key++} class="md-heading">
                    {inline(heading[1]!, cursor)}
                </p>,
            );
            i++;
            continue;
        }

        if (!line.trim()) {
            i++;
            continue;
        }

        const paragraph: string[] = [];
        while (
            i < lines.length &&
            lines[i]!.trim() &&
            !/^\s*(```|[-*]\s|\d+\.\s|#{1,6}\s)/.test(lines[i]!)
        ) {
            paragraph.push(lines[i++]!);
        }
        out.push(<p key={key++}>{inline(paragraph.join(' '), cursor)}</p>);
    }
    return out;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, cursor: WordCursor): ComponentChildren[] {
    return text.split(INLINE).map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
            cursor.index += countWords(part);
            return <code key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
            return <strong key={index}>{words(part.slice(2, -2), cursor)}</strong>;
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (link && /^https?:\/\//.test(link[2]!)) {
            return (
                <a key={index} href={link[2]} target="_blank" rel="noreferrer">
                    {words(link[1]!, cursor)}
                </a>
            );
        }
        return words(part, cursor);
    });
}

/** Splits on whitespace (kept as bare text so lines still wrap) and wraps fresh words. */
function words(text: string, cursor: WordCursor): ComponentChildren {
    if (cursor.animateFrom === Number.POSITIVE_INFINITY) {
        cursor.index += countWords(text);
        return text;
    }
    return text.split(/(\s+)/).map(token => {
        if (!token || /^\s+$/.test(token)) return token;
        const position = cursor.index++;
        return position >= cursor.animateFrom ? (
            <span key={`w${position}`} class="w">
                {token}
            </span>
        ) : (
            token
        );
    });
}

function countWords(text: string): number {
    const matches = text.match(/\S+/g);
    return matches ? matches.length : 0;
}

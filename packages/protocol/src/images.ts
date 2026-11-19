import type { ProviderImage } from './provider.ts';

/** Raster types only: the overlay never shows an SVG or HTML an agent produced. */
export const AGENT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** The largest image a message carries, as a data URL (the same limit as attachments). */
export const MAX_AGENT_IMAGE_CHARS = 14_000_000;

/** Most images taken from one tool result. */
const MAX_TOOL_IMAGES = 8;
const MAX_DEPTH = 8;

/** An image from its type and base64 body, or nothing when the overlay wouldn't show it. */
export function agentImage(
    mimeType: unknown,
    base64: unknown,
    name?: string,
): ProviderImage | undefined {
    if (typeof mimeType !== 'string' || typeof base64 !== 'string' || !base64) return undefined;
    const type = mimeType.toLowerCase();
    if (!(AGENT_IMAGE_TYPES as readonly string[]).includes(type)) return undefined;
    const dataUrl = `data:${type};base64,${base64}`;
    if (dataUrl.length > MAX_AGENT_IMAGE_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        return undefined;
    }
    return name ? { dataUrl, name } : { dataUrl };
}

/** The type of a data URL made by `agentImage`, e.g. `image/png`. */
export function dataUrlType(dataUrl: string): string | undefined {
    return /^data:(image\/[a-z]+);base64,/.exec(dataUrl)?.[1];
}

/**
 * The images in a tool's result, in order. Reads the two shapes agents use:
 * Anthropic content blocks (`{ type: 'image', source: { type: 'base64', media_type, data } }`)
 * and MCP ones (`{ type: 'image', mimeType, data }`), in an array, a `content`
 * array, or nested `tool_result` blocks.
 */
export function toolOutputImages(value: unknown): ProviderImage[] {
    const images: ProviderImage[] = [];
    collect(value, images, 0);
    return images;
}

function collect(value: unknown, images: ProviderImage[], depth: number): void {
    if (images.length >= MAX_TOOL_IMAGES || depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
        for (const entry of value) collect(entry, images, depth + 1);
        return;
    }
    if (typeof value !== 'object' || value === null) return;
    const block = value as Record<string, unknown>;
    if (block.type === 'image') {
        const source = block.source as Record<string, unknown> | undefined;
        const image =
            source && typeof source === 'object'
                ? source.type === 'base64'
                    ? agentImage(source.media_type, source.data)
                    : undefined
                : agentImage(block.mimeType ?? block.mime_type, block.data);
        if (image) images.push(image);
        return;
    }
    if (Array.isArray(block.content)) collect(block.content, images, depth + 1);
}

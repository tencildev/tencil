import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
    agentImage,
    MAX_AGENT_IMAGE_CHARS,
    type ProviderImage,
    toolOutputImages,
} from '@tencildev/protocol';
import type { ThreadItem } from './protocol.ts';

/** Base64 grows bytes by a third; leave room for the `data:` prefix. */
const MAX_FILE_BYTES = Math.floor((MAX_AGENT_IMAGE_CHARS - 64) * 0.75);

/**
 * The images a finished item showed Codex: a file it viewed (`view_image`),
 * an MCP tool's image content (a browser screenshot), a dynamic tool's images.
 */
export function itemImages(item: ThreadItem): ProviderImage[] {
    switch (item.type) {
        case 'imageView': {
            const image = imageFile(item.path);
            return image ? [image] : [];
        }
        case 'mcpToolCall':
            return toolOutputImages(item.result?.content);
        case 'dynamicToolCall':
            return (item.contentItems ?? []).flatMap(content => {
                if (content.type !== 'inputImage' || typeof content.imageUrl !== 'string')
                    return [];
                const match = /^data:([^;,]+);base64,(.*)$/s.exec(content.imageUrl);
                const image = match && agentImage(match[1], match[2]);
                return image ? [image] : [];
            });
        default:
            return [];
    }
}

/** An image file on this machine, when its bytes really are a raster image. */
function imageFile(path: string): ProviderImage | undefined {
    if (!isAbsolute(path)) return undefined;
    try {
        if (statSync(path).size > MAX_FILE_BYTES) return undefined;
        const bytes = readFileSync(path);
        const type = sniff(bytes);
        const name = path.split(/[\\/]/).at(-1);
        return type ? agentImage(type, bytes.toString('base64'), name) : undefined;
    } catch {
        return undefined;
    }
}

function sniff(bytes: Buffer): string | undefined {
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
    if (
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
        bytes.subarray(8, 12).toString('latin1') === 'WEBP'
    )
        return 'image/webp';
    return undefined;
}

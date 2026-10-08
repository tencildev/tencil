import { z } from 'zod';

/** A resolved source location for the element, usually from React's owner stack. */
export const SourceLocation = z.object({
    file: z.string(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
});
export type SourceLocation = z.infer<typeof SourceLocation>;

export const ComponentFrame = z.object({
    name: z.string(),
    source: SourceLocation.optional(),
    /** `node_modules` package the component lives in, if it isn't app code. */
    library: z.string().optional(),
});
export type ComponentFrame = z.infer<typeof ComponentFrame>;

export const Rect = z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
});
export type Rect = z.infer<typeof Rect>;

/**
 * Everything the overlay knows about the picked element. Captured once when
 * the pin is placed and forwarded to the agent as context.
 */
export const ElementContext = z.object({
    tagName: z.string(),
    selector: z.string(),
    /** Trimmed outerHTML preview, safe to put in a prompt. */
    html: z.string(),
    text: z.string().optional(),
    /** Innermost component first. */
    components: z.array(ComponentFrame).default([]),
    rect: Rect,
    viewport: z.object({ width: z.number(), height: z.number(), dpr: z.number() }),
    /** Selected text inside the element at pin time, if any. */
    selection: z.string().optional(),
});
export type ElementContext = z.infer<typeof ElementContext>;

/** Where a pin sits: the element plus the click offset inside it (0..1). */
export const Anchor = z.object({
    selector: z.string(),
    offsetX: z.number().min(0).max(1),
    offsetY: z.number().min(0).max(1),
});
export type Anchor = z.infer<typeof Anchor>;

export const ImageAttachment = z.object({
    name: z.string(),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    dataUrl: z.string().startsWith('data:image/').max(14_000_000),
});
export type ImageAttachment = z.infer<typeof ImageAttachment>;

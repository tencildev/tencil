import { deflateSync } from 'node:zlib';

/**
 * A small PNG that looks like a screenshot of a page (a header bar, a card and
 * a button on a light background), as base64, for an agent's tool output.
 */
export function testScreenshot(width = 320, height = 200): string {
    const rows: Buffer[] = [];
    for (let y = 0; y < height; y++) {
        const row = Buffer.alloc(1 + width * 3);
        for (let x = 0; x < width; x++) {
            row.set(pixel(x, y, width, height), 1 + x * 3);
        }
        rows.push(row);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(rows))),
        chunk('IEND', Buffer.alloc(0)),
    ]).toString('base64');
}

function pixel(x: number, y: number, width: number, height: number): [number, number, number] {
    if (y < height * 0.14) return [24, 24, 27];
    const inCard = x > width * 0.1 && x < width * 0.9 && y > height * 0.26 && y < height * 0.86;
    if (!inCard) return [244, 244, 245];
    const inButton = x > width * 0.16 && x < width * 0.44 && y > height * 0.66 && y < height * 0.78;
    if (inButton) return [79, 70, 229];
    const inLine = x > width * 0.16 && x < width * 0.7 && y > height * 0.36 && y < height * 0.42;
    return inLine ? [212, 212, 216] : [255, 255, 255];
}

function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function crc32(bytes: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

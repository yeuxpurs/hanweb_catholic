import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// Raster counterparts of favicon.svg, generated without a canvas dependency.
const crc = buffer => {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (name, bytes) => {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([type, bytes])));
  return Buffer.concat([length, type, bytes, checksum]);
};
for (const size of [192, 512]) {
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x * 64 / size, py = y * 64 / size;
    let rgb = [20, 92, 84];
    if (px >= 19 && px < 47 && py >= 12 && py < 52 && (py >= 20 || px - 39 <= py - 12)) rgb = [255, 253, 245];
    if (px >= 39 && px < 47 && py >= 12 && py < 22 && px - 39 <= py - 12) rgb = [211, 231, 223];
    if ((px >= 30.5 && px < 33.5 && py >= 24 && py < 39) || (px >= 26 && px < 38 && py >= 27.5 && py < 30.5)) rgb = [178, 139, 68];
    if ((px >= 25 && px < 41 && py >= 43 && py < 45) || (px >= 25 && px < 37 && py >= 48 && py < 50)) rgb = [20, 92, 84];
    const offset = y * (size * 3 + 1) + 1 + x * 3;
    rows.set(rgb, offset);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  await writeFile(new URL(`../client/public/icon-${size}.png`, import.meta.url), png);
}

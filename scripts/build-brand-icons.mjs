// Reproducible raster exports of the source-controlled SVG mark.
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
const source = await readFile(new URL("../app/icon.svg", import.meta.url));
for (const [path, size] of [
  ["app/apple-icon.png", 180],
  ["public/brand/icon-192.png", 192],
  ["public/brand/icon-512.png", 512],
]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(new URL("../" + path, import.meta.url).pathname);
}
const frames = await Promise.all(
  [16, 32, 48].map((size) => sharp(source).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, i) => {
  const entry = 6 + i * 16;
  const size = [16, 32, 48][i];
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(
  new URL("../app/favicon.ico", import.meta.url),
  Buffer.concat([header, ...frames]),
);
console.log("Exported robot favicon, Apple icon, and manifest icons.");

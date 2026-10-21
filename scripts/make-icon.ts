/**
 * web/icon.svg → assets/icon.png (256 px) + assets/icon.ico (16–256 px).
 * Each size is rendered by headless Edge (proper anti-aliasing at every size), then cropped.
 * Small sizes are stored as 32-bit DIBs (what System.Drawing / the tray expect), 256 px as PNG.
 *   deno run -A scripts/make-icon.ts
 */
import { PNG } from "pngjs";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const svg = Deno.readTextFileSync(join(root, "web", "icon.svg"));
const SIZES = [256, 128, 64, 48, 32, 24, 16];
const width = SIZES.reduce((a, s) => a + s + 8, 0);

const tmp = Deno.makeTempDirSync({ prefix: "radar-icon-" });
const html = join(tmp, "icons.html");
let x = 0;
const imgs = SIZES.map((s) => {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const tag = `<img src="${src}" style="position:absolute;left:${x}px;top:0;width:${s}px;height:${s}px">`;
  x += s + 8;
  return tag;
}).join("");
Deno.writeTextFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent">${imgs}</body></html>`);

const shot = join(tmp, "shot.png");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const out = await new Deno.Command(edge, {
  args: [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--default-background-color=00000000",
    `--user-data-dir=${join(tmp, "profile")}`,
    `--window-size=${width},256`,
    `--screenshot=${shot}`,
    pathToFileURL(html).href,
  ],
  stdout: "null",
  stderr: "piped",
}).output();
if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));

const sheet = PNG.sync.read(Buffer.from(Deno.readFileSync(shot)));

function crop(left: number, size: number): PNG {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let xx = 0; xx < size; xx++) {
      const si = (y * sheet.width + left + xx) * 4;
      const di = (y * size + xx) * 4;
      for (let k = 0; k < 4; k++) png.data[di + k] = sheet.data[si + k];
    }
  }
  return png;
}

/** BITMAPINFOHEADER + bottom-up BGRA + empty AND mask */
function dib(png: PNG): Uint8Array {
  const s = png.width;
  const maskRow = Math.ceil(s / 32) * 4;
  const buf = new Uint8Array(40 + s * s * 4 + maskRow * s);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 40, true);
  v.setInt32(4, s, true);
  v.setInt32(8, s * 2, true);
  v.setUint16(12, 1, true);
  v.setUint16(14, 32, true);
  v.setUint32(20, s * s * 4 + maskRow * s, true);
  for (let y = 0; y < s; y++) {
    for (let xx = 0; xx < s; xx++) {
      const si = (y * s + xx) * 4;
      const di = 40 + ((s - 1 - y) * s + xx) * 4;
      buf[di] = png.data[si + 2];
      buf[di + 1] = png.data[si + 1];
      buf[di + 2] = png.data[si];
      buf[di + 3] = png.data[si + 3];
    }
  }
  return buf;
}

const frames: { size: number; data: Uint8Array }[] = [];
let left = 0;
for (const s of SIZES) {
  const png = crop(left, s);
  left += s + 8;
  if (s === 256) Deno.writeFileSync(join(root, "assets", "icon.png"), PNG.sync.write(png));
  frames.push({ size: s, data: s >= 128 ? new Uint8Array(PNG.sync.write(png)) : dib(png) });
}

const header = new Uint8Array(6 + 16 * frames.length);
const hv = new DataView(header.buffer);
hv.setUint16(2, 1, true);
hv.setUint16(4, frames.length, true);
let offset = header.length;
frames.forEach((f, i) => {
  const o = 6 + 16 * i;
  header[o] = f.size >= 256 ? 0 : f.size;
  header[o + 1] = f.size >= 256 ? 0 : f.size;
  hv.setUint16(o + 4, 1, true);
  hv.setUint16(o + 6, 32, true);
  hv.setUint32(o + 8, f.data.length, true);
  hv.setUint32(o + 12, offset, true);
  offset += f.data.length;
});
const ico = new Uint8Array(offset);
ico.set(header, 0);
let pos = header.length;
for (const f of frames) {
  ico.set(f.data, pos);
  pos += f.data.length;
}
Deno.writeFileSync(join(root, "assets", "icon.ico"), ico);
Deno.removeSync(tmp, { recursive: true });
console.log(`icon.ico: ${frames.map((f) => f.size).join(", ")} px, ${ico.length} bytes`);

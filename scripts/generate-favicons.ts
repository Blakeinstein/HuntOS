#!/usr/bin/env bun
/**
 * Generates the full HuntOS favicon set from static/logo.svg using sharp.
 *
 * Output (all written to static/):
 *   favicon.ico          – 16×16 + 32×32 + 48×48 multi-size ICO
 *   favicon-16x16.png
 *   favicon-32x32.png
 *   favicon-48x48.png
 *   favicon-96x96.png
 *   apple-touch-icon.png – 180×180
 *   android-chrome-192x192.png
 *   android-chrome-512x512.png
 *   mstile-150x150.png
 *   og-image.png         – 1200×630 Open Graph card
 *   site.webmanifest
 *   browserconfig.xml
 */

import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const STATIC = path.join(ROOT, "static");
const SVG_SRC = path.join(STATIC, "logo.svg");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pngFrom(sizePx: number): Promise<Buffer> {
  return sharp(SVG_SRC, { density: Math.ceil((sizePx / 512) * 72 * 4) })
    .resize(sizePx, sizePx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/**
 * Minimal ICO encoder — supports 1-to-n PNG frames embedded directly.
 * The ICO format stores a ICONDIR header, one ICONDIRENTRY per image,
 * then the raw PNG data for each image (Windows Vista+ supports PNG-in-ICO).
 */
function buildIco(frames: Buffer[]): Buffer {
  const ICONDIR_SIZE = 6; // WORD idReserved, WORD idType, WORD idCount
  const ENTRY_SIZE = 16; // per ICONDIRENTRY

  const headerSize = ICONDIR_SIZE + ENTRY_SIZE * frames.length;
  const parts: Buffer[] = [];

  // ICONDIR
  const dir = Buffer.alloc(ICONDIR_SIZE);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type = 1 (ICO)
  dir.writeUInt16LE(frames.length, 4);
  parts.push(dir);

  // ICONDIRENTRY placeholders — we'll fill offsets after we know sizes
  const entries: Buffer[] = frames.map(() => Buffer.alloc(ENTRY_SIZE));
  parts.push(...entries);

  let offset = headerSize;
  frames.forEach((frame, i) => {
    // Parse width/height from PNG IHDR (bytes 16-23)
    const w = frame.readUInt32BE(16);
    const h = frame.readUInt32BE(20);
    const entry = entries[i];

    entry.writeUInt8(w >= 256 ? 0 : w, 0);   // width  (0 = 256)
    entry.writeUInt8(h >= 256 ? 0 : h, 1);   // height (0 = 256)
    entry.writeUInt8(0, 2);                    // color count
    entry.writeUInt8(0, 3);                    // reserved
    entry.writeUInt16LE(1, 4);                 // planes
    entry.writeUInt16LE(32, 6);                // bit count
    entry.writeUInt32LE(frame.length, 8);      // size of image data
    entry.writeUInt32LE(offset, 12);           // offset from beginning of file
    offset += frame.length;
  });

  parts.push(...frames);
  return Buffer.concat(parts);
}

async function writePng(name: string, buf: Buffer): Promise<void> {
  const dest = path.join(STATIC, name);
  await fs.promises.writeFile(dest, buf);
  const kb = (buf.length / 1024).toFixed(1);
  console.log(`  ✓  ${name.padEnd(36)} ${kb.padStart(7)} KB`);
}

async function writeText(name: string, content: string): Promise<void> {
  const dest = path.join(STATIC, name);
  await fs.promises.writeFile(dest, content, "utf8");
  console.log(`  ✓  ${name}`);
}

// ---------------------------------------------------------------------------
// Open Graph card  (1200×630, dark background + centred logo)
// ---------------------------------------------------------------------------

async function buildOgImage(): Promise<Buffer> {
  // Render the logo at 400×400 for the card
  const logoBuf = await sharp(SVG_SRC, { density: 288 })
    .resize(400, 400, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Dark slate background (#0F172A) at 1200×630
  return sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  })
    .composite([{ input: logoBuf, gravity: "center" }])
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// site.webmanifest
// ---------------------------------------------------------------------------

const WEBMANIFEST = JSON.stringify(
  {
    name: "HuntOS",
    short_name: "HuntOS",
    description: "Automated job application assistant",
    start_url: "/",
    display: "standalone",
    background_color: "#0F172A",
    theme_color: "#0EA5E9",
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  null,
  2
);

// ---------------------------------------------------------------------------
// browserconfig.xml  (IE11 / legacy Edge pinned-site tile)
// ---------------------------------------------------------------------------

const BROWSERCONFIG = `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square150x150logo src="/mstile-150x150.png"/>
      <TileColor>#0F172A</TileColor>
    </tile>
  </msapplication>
</browserconfig>
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n🎨  Generating HuntOS favicon set…\n");

  const [
    png16,
    png32,
    png48,
    png96,
    png180,
    png192,
    png512,
    png150,
  ] = await Promise.all([
    pngFrom(16),
    pngFrom(32),
    pngFrom(48),
    pngFrom(96),
    pngFrom(180),
    pngFrom(192),
    pngFrom(512),
    pngFrom(150),
  ]);

  const [ogBuf] = await Promise.all([buildOgImage()]);

  const ico = buildIco([png16, png32, png48]);

  await Promise.all([
    fs.promises.writeFile(path.join(STATIC, "favicon.ico"), ico).then(() => {
      const kb = (ico.length / 1024).toFixed(1);
      console.log(`  ✓  ${"favicon.ico".padEnd(36)} ${kb.padStart(7)} KB`);
    }),
    writePng("favicon-16x16.png", png16),
    writePng("favicon-32x32.png", png32),
    writePng("favicon-48x48.png", png48),
    writePng("favicon-96x96.png", png96),
    writePng("apple-touch-icon.png", png180),
    writePng("android-chrome-192x192.png", png192),
    writePng("android-chrome-512x512.png", png512),
    writePng("mstile-150x150.png", png150),
    writePng("og-image.png", ogBuf),
    writeText("site.webmanifest", WEBMANIFEST),
    writeText("browserconfig.xml", BROWSERCONFIG),
  ]);

  console.log("\n✅  Done — all assets written to static/\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

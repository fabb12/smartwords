// Regenerates the PWA icons in public/icons from the app mark: `node scripts/pwa-icons.mjs`.
import sharp from 'sharp';
const mark = '<path d="m18 46 26-26m-28 7 3-9 3 9 9 3-9 3-3 9-3-9-9-3zm30 14 2-6 2 6 6 2-6 2-2 6-2-6-6-2z" stroke="#ebf2d7" stroke-width="3" fill="none" stroke-linecap="round"/>';
// any: rounded tile as the favicon; full: square tile (iOS and maskable crops), mark inside the safe zone.
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="17" fill="#345847"/>${mark}</svg>`;
const full = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#345847"/><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${mark}</g></svg>`;
const out = [['icon-192.png', any, 192], ['icon-512.png', any, 512], ['maskable-512.png', full(0.72), 512], ['apple-touch-icon.png', full(0.86), 180]];
for (const [name, svg, size] of out) await sharp(Buffer.from(svg), { density: 72 * size / 64 }).resize(size, size).png().toFile('public/icons/' + name);

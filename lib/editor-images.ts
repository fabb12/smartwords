import { A4 } from './pagination.ts';

export const IMAGE_MAX_FILE = 12_000_000;
const TYPES = ['image/png','image/jpeg','image/webp','image/avif'];
export function fitImage(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Dimensioni dell’immagine non valide.');
  const ratio = Math.min(1, (A4.width - 2 * A4.margin) / width, (A4.height - 2 * A4.margin - 24) / height);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export async function prepareEditorImage(file: Blob) {
  if (!TYPES.includes(file.type)) throw new Error('Scegli un’immagine PNG, JPEG, WebP o AVIF.');
  if (file.size > IMAGE_MAX_FILE) throw new Error('Scegli un’immagine fino a 12 MB.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    if (natural.width * natural.height > 40_000_000) throw new Error('L’immagine supera 40 megapixel: riducila prima di inserirla.');
    const layout = fitImage(natural.width, natural.height), canvas = document.createElement('canvas');
    // Store at up to twice the display resolution; keep alpha for screenshots.
    const scale = Math.min(1, layout.width * 2 / natural.width, layout.height * 2 / natural.height);
    let width = Math.max(1, Math.round(natural.width * scale)), height = Math.max(1, Math.round(natural.height * scale));
    for (let attempt = 0; attempt < 9; attempt++) {
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Impossibile preparare l’immagine in questo browser.');
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', .85));
      if (!blob) throw new Error('Impossibile preparare l’immagine.');
      if (blob.size <= 350_000) {
        const src = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Impossibile leggere l’immagine.')); reader.readAsDataURL(blob); });
        return { src, ...layout };
      }
      width = Math.max(1, Math.round(width * .75)); height = Math.max(1, Math.round(height * .75));
    }
    throw new Error('Immagine troppo complessa: riducila prima di inserirla.');
  } catch (err) {
    if (err instanceof Error && err.name === 'EncodingError') throw new Error('Il file non contiene un’immagine leggibile.');
    throw err;
  } finally { URL.revokeObjectURL(url); }
}

export async function clipboardImage(): Promise<Blob> {
  if (!navigator.clipboard?.read) throw new Error('Usa Incolla nell’editor (Ctrl+V o ⌘V) oppure scegli un file immagine.');
  let items: ClipboardItems;
  try { items = await navigator.clipboard.read(); }
  catch { throw new Error('Accesso agli appunti non disponibile: usa Incolla nell’editor (Ctrl+V o ⌘V) oppure scegli un file immagine.'); }
  for (const item of items) { const type = item.types.find(t => TYPES.includes(t)); if (type) return item.getType(type); }
  throw new Error('Gli appunti non contengono un’immagine. Copia un’immagine oppure scegli un file.');
}

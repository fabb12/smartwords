import { A4 } from './pagination.ts';

export const IMAGE_MAX_FILE = 12_000_000;
const TYPES = ['image/png','image/jpeg','image/webp','image/avif'];
export function fitImage(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Dimensioni dell’immagine non valide.');
  const ratio = Math.min(1, (A4.width - 2 * A4.margin) / width, (A4.height - 2 * A4.margin - 24) / height);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

// Stored copy of an inserted image: up to 2.5 times the size shown on the page (sharp on dense screens, in Word and
// in the PDF), never enlarged beyond the original, within a size budget so documents stay light.
export const IMAGE_DENSITY = 2.5;
export const IMAGE_STORED_BUDGET = 600_000;
const JPEG_QUALITIES = [0.92, 0.86, 0.8];
export function storedImageSize(natural: { width: number; height: number }, shown: { width: number; height: number }) {
  const scale = Math.min(1, shown.width * IMAGE_DENSITY / natural.width, shown.height * IMAGE_DENSITY / natural.height);
  return { width: Math.max(1, Math.round(natural.width * scale)), height: Math.max(1, Math.round(natural.height * scale)) };
}
// Lossless PNG for charts, screenshots and anything with transparency while it fits the budget; photos that do not fit
// become high-quality JPEG (several times lighter) and are shrunk only as a last resort, in small steps.
export function imageEncodings(type: string, pngFits: boolean | null, opaque: boolean | null): { mime: 'image/png' | 'image/jpeg'; quality?: number }[] {
  const jpeg = JPEG_QUALITIES.map(quality => ({ mime: 'image/jpeg' as const, quality }));
  if (type === 'image/jpeg') return jpeg;
  if (pngFits === null) return [{ mime: 'image/png' }];
  return pngFits ? [] : opaque ? jpeg : [{ mime: 'image/png' }];
}
const hasTransparency = (context: CanvasRenderingContext2D, width: number, height: number) => {
  const data = context.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 16) if (data[i] < 250) return true;
  return false;
};

export async function prepareEditorImage(file: Blob) {
  if (!TYPES.includes(file.type)) throw new Error('Scegli un’immagine PNG, JPEG, WebP o AVIF.');
  if (file.size > IMAGE_MAX_FILE) throw new Error('Scegli un’immagine fino a 12 MB.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    if (natural.width * natural.height > 40_000_000) throw new Error('L’immagine supera 40 megapixel: riducila prima di inserirla.');
    const layout = fitImage(natural.width, natural.height), canvas = document.createElement('canvas');
    let { width, height } = storedImageSize(natural, layout);
    let pngFits: boolean | null = null, opaque: boolean | null = file.type === 'image/jpeg' ? true : null;
    const toBlob = (mime: string, quality?: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
    const finish = async (blob: Blob) => {
      const src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Impossibile leggere l’immagine.')); reader.readAsDataURL(blob); });
      return { src, ...layout };
    };
    // One size: PNG first; if it is too heavy and the image has no transparency, JPEG at decreasing quality.
    const encode = async (context: CanvasRenderingContext2D) => {
      for (let pass = 0; pass < 2; pass++) {
        const steps = imageEncodings(file.type, pngFits, opaque);
        for (const step of steps) {
          const blob = await toBlob(step.mime, step.quality);
          if (!blob) throw new Error('Impossibile preparare l’immagine.');
          if (step.mime === 'image/png') { pngFits = blob.size <= IMAGE_STORED_BUDGET; if (opaque === null && !pngFits) opaque = !hasTransparency(context, width, height); }
          if (blob.size <= IMAGE_STORED_BUDGET) return blob;
        }
        if (!(steps[0]?.mime === 'image/png' && pngFits === false && opaque)) return null;
      }
      return null;
    };
    for (let attempt = 0; attempt < 12; attempt++) {
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Impossibile preparare l’immagine in questo browser.');
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);
      const blob = await encode(context);
      if (blob) return finish(blob);
      // Still too heavy even as JPEG (or PNG with transparency): a little smaller, 15% per step, keeping the proportions.
      width = Math.max(1, Math.round(width * .85)); height = Math.max(1, Math.round(height * .85));
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

// Display size of an image at a share of the page width (never taller than the page, never below 40 px).
export function imageSizeAt(width: number, height: number, share: number) {
  if (!(width > 0) || !(height > 0)) throw new Error('Dimensioni dell’immagine non valide.');
  const maxWidth = A4.width - 2 * A4.margin, maxHeight = A4.height - 2 * A4.margin - 24;
  const ratio = Math.min(maxWidth * Math.min(1, Math.max(0.05, share)) / width, maxHeight / height);
  return { width: Math.max(40, Math.round(width * ratio)), height: Math.max(40, Math.round(height * ratio)) };
}
// A typed width in pixels, with the height following the proportions and both kept inside the page.
export function imageSizeForWidth(width: number, height: number, wanted: number) {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(wanted)) throw new Error('Dimensioni dell’immagine non valide.');
  const maxWidth = A4.width - 2 * A4.margin, maxHeight = A4.height - 2 * A4.margin - 24;
  const w = Math.min(maxWidth, Math.max(40, wanted)), ratio = Math.min(w / width, maxHeight / height);
  return { width: Math.max(40, Math.round(width * ratio)), height: Math.max(40, Math.round(height * ratio)) };
}
export const pageShare = (width: number) => Math.round(width / (A4.width - 2 * A4.margin) * 100);

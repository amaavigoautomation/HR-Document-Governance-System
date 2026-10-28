import { MAX_IDENTITY_FILE_CHARS } from '../../../shared/employeeIdentity';

/**
 * Turns a chosen photo into a JPEG data URL small enough to store. Redrawing it also drops the camera's hidden details
 * (location, device). Tries smaller sizes until it fits.
 */
export async function shrinkImage(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('Choose an image file (JPG or PNG).');
  if (file.size > 25 * 1024 * 1024) throw new Error('That image is too large.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file could not be read as an image.'));
      i.src = url;
    });
    for (const [side, quality] of [[1600, 0.8], [1400, 0.7], [1200, 0.6], [1000, 0.5], [800, 0.5]] as const) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Your browser cannot prepare this image.');
      ctx.fillStyle = '#fff'; // PNGs with see-through areas would turn black as JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL('image/jpeg', quality);
      if (out.length <= MAX_IDENTITY_FILE_CHARS) return out;
    }
    throw new Error('That image is too detailed to store. Try a smaller photo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

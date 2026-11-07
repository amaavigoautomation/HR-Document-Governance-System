/** Turns a chosen picture into a small square JPEG (centre-cropped) as a data URL, ready to store. */
export async function toProfilePhoto(file: File, side = 256): Promise<string> {
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
    const crop = Math.min(img.width, img.height);
    for (const [px, quality] of [[side, 0.85], [side, 0.7], [192, 0.7], [128, 0.7]] as const) {
      const canvas = document.createElement('canvas');
      canvas.width = px; canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Your browser cannot prepare this image.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, px, px);
      ctx.drawImage(img, (img.width - crop) / 2, (img.height - crop) / 2, crop, crop, 0, 0, px, px);
      const out = canvas.toDataURL('image/jpeg', quality);
      if (out.length <= 140_000) return out;
    }
    throw new Error('That image is too detailed to store. Try another.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

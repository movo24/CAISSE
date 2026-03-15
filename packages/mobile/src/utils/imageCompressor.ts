// ── Image Compressor ─────────────────────────────────────────────
// Compresses and resizes images on the client before upload.
// Uses canvas to resize to max 400x400 and JPEG quality 0.7.
// Returns a base64 data URL string (~15-30KB per image).
// ─────────────────────────────────────────────────────────────────

const MAX_SIZE = 400; // px (both width and height)
const JPEG_QUALITY = 0.7;

/**
 * Compress a File (from <input type="file">) to a small JPEG data URL.
 * Returns null if the file cannot be processed.
 */
export function compressImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      console.error('[ImageCompressor] Not an image:', file.type);
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          // Calculate new dimensions maintaining aspect ratio
          let { width, height } = img;
          if (width > MAX_SIZE || height > MAX_SIZE) {
            if (width > height) {
              height = Math.round(height * (MAX_SIZE / width));
              width = MAX_SIZE;
            } else {
              width = Math.round(width * (MAX_SIZE / height));
              height = MAX_SIZE;
            }
          }

          // Draw to canvas
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          // Export as JPEG data URL
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
          console.log(`[ImageCompressor] ${img.naturalWidth}x${img.naturalHeight} → ${width}x${height}, ~${sizeKB}KB`);

          resolve(dataUrl);
        } catch (err) {
          console.error('[ImageCompressor] Canvas error:', err);
          resolve(null);
        }
      };
      img.onerror = () => {
        console.error('[ImageCompressor] Failed to load image');
        resolve(null);
      };
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

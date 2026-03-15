// ── ProductImagePicker ───────────────────────────────────────────
// Standalone component for adding/replacing a product photo.
// Two options: take a photo (camera) or pick from gallery.
// Compresses the image before returning the data URL.
//
// Usage:
//   <ProductImagePicker
//     currentImage={product.imageUrl}
//     onImageSelected={(dataUrl) => uploadImage(dataUrl)}
//     uploading={uploading}
//   />
// ─────────────────────────────────────────────────────────────────

import { useRef, useState } from 'react';
import { Camera, ImageIcon, Loader2, Trash2, X } from 'lucide-react';
import { compressImage } from '../utils/imageCompressor';

interface ProductImagePickerProps {
  currentImage?: string | null;
  onImageSelected: (dataUrl: string) => void;
  onImageRemoved?: () => void;
  uploading?: boolean;
}

export function ProductImagePicker({
  currentImage,
  onImageSelected,
  onImageRemoved,
  uploading = false,
}: ProductImagePickerProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelected = async (file: File) => {
    setError(null);
    setCompressing(true);

    try {
      const dataUrl = await compressImage(file);
      if (!dataUrl) {
        setError('Impossible de traiter cette image');
        return;
      }
      setPreview(dataUrl);
    } catch {
      setError('Erreur lors du traitement');
    } finally {
      setCompressing(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelected(file);
      // Reset input so same file can be re-selected
      e.target.value = '';
    }
    setShowOptions(false);
  };

  const handleConfirm = () => {
    if (preview) {
      onImageSelected(preview);
      setPreview(null);
    }
  };

  const handleCancel = () => {
    setPreview(null);
    setError(null);
  };

  const handleRemove = () => {
    onImageRemoved?.();
    setShowOptions(false);
  };

  // ── Preview mode: show captured/selected image with confirm/cancel ──
  if (preview) {
    return (
      <div className="space-y-3">
        <div className="relative w-full aspect-square max-w-[200px] mx-auto rounded-2xl overflow-hidden bg-gray-100">
          <img src={preview} alt="Aperçu" className="w-full h-full object-cover" />
          {uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <Loader2 size={28} className="text-white animate-spin" />
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            disabled={uploading}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <X size={14} />
            Reprendre
          </button>
          <button
            onClick={handleConfirm}
            disabled={uploading}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Envoi...
              </>
            ) : (
              'Valider'
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── Normal mode: show current image or placeholder + add button ──
  return (
    <div className="space-y-2">
      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={handleInputChange}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleInputChange}
        className="hidden"
      />

      {/* Current image or placeholder */}
      <div className="relative w-full aspect-square max-w-[200px] mx-auto rounded-2xl overflow-hidden bg-gray-100">
        {currentImage ? (
          <img src={currentImage} alt="Produit" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
            <Camera size={36} />
            <span className="text-xs mt-1">Pas de photo</span>
          </div>
        )}

        {compressing && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Loader2 size={28} className="text-white animate-spin" />
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-500 text-center">{error}</p>}

      {/* Action button */}
      {!showOptions ? (
        <button
          onClick={() => setShowOptions(true)}
          disabled={compressing || uploading}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-violet-300 text-violet-600 text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-40"
        >
          <Camera size={16} />
          {currentImage ? 'Changer la photo' : 'Ajouter une photo'}
        </button>
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="w-full py-3 rounded-xl bg-violet-600 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
          >
            <Camera size={16} />
            Prendre une photo
          </button>

          <button
            onClick={() => galleryInputRef.current?.click()}
            className="w-full py-3 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
          >
            <ImageIcon size={16} />
            Choisir dans les photos
          </button>

          {currentImage && onImageRemoved && (
            <button
              onClick={handleRemove}
              className="w-full py-2.5 rounded-xl text-red-500 text-sm font-medium flex items-center justify-center gap-1.5"
            >
              <Trash2 size={14} />
              Supprimer la photo
            </button>
          )}

          <button
            onClick={() => setShowOptions(false)}
            className="w-full py-2 text-xs text-gray-400 font-medium"
          >
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}

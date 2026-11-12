import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import type { Product } from '@/types/database';

/**
 * The shelf photos.
 *
 * A photo is a file in the public `product-images` bucket plus the public URL in
 * `products.image_url`. The bucket and its four policies already existed
 * (migration 20261003000001: anyone may read, only an admin may write), so this
 * file is the phone-sized version of what the web panel's Products page does with
 * a drag-and-drop — for the owner who runs the shop from the counter.
 *
 * A photograph is compressed before it is uploaded (`prepareUploadBlob`): the
 * bucket's own 5 MB cap is the ceiling, not the target — a shelf photo that
 * every customer's phone has to download is sized for a card, not for a camera.
 *
 * The database still decides who may write: storage RLS and products RLS both
 * answer to `public.is_admin()`. The app only chooses a path and a picture.
 */

const BUCKET = 'product-images';

/** The bucket refuses anything else (migration 20261003000001), and caps at 5 MB. */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * What a shelf photograph needs to be: the grid draws cards a few centimetres
 * tall, and `expo-image` caches whatever it is handed, so a photo the owner
 * uploads is re-downloaded by every customer who scrolls past it — on metered
 * 4G, in both languages and both themes, forever. 800 px on the longest side is
 * comfortably sharp at that size, and WEBP at 0.8 turns a phone camera's square
 * into a fraction of the file.
 */
const LONGEST_SIDE_PX = 800;
const WEBP_QUALITY = 0.8;

/** What actually goes up: the bytes and the content type they claim to be. */
type UploadBlob = { blob: Blob; mime: string };

/**
 * Read the picked photo and, on a phone, shrink it before it goes up.
 *
 * The image manipulator is a native module, so it is imported lazily inside the
 * async path with the same shape as `use-online-payment.ts` (AGENTS §3): Metro
 * keeps it out of the entry bundle the web export builds, where this code never
 * runs — the owner photographs the shelf from the phone, not from the web
 * build. `ImageManipulator` is the native module object itself, and
 * `manipulate()` accepts either a uri or a rendered image, so the file is
 * decoded ONCE to learn its real size and only an oversized picture is rendered
 * again, resized, and saved as WEBP. `SharedRef.release()` frees both renders —
 * a decoded photo is native memory, not a JS object, and a shop owner with a
 * 100-megapixel camera should not OOM the app by uploading a shelf.
 *
 * Every failure falls back to the original file: a photo that arrives the old
 * way (still gated by MAX_BYTES at the call site) beats one that does not
 * arrive at all. The technical reason stays in the console, never on screen.
 */
async function prepareUploadBlob(uri: string, fallbackMime: string): Promise<UploadBlob> {
  const response = await fetch(uri);
  const original = await response.blob();
  if (original.size === 0) throw new Error('photo_failed');

  if (Platform.OS === 'web') return { blob: original, mime: fallbackMime };

  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');

    // Decode once to learn the real dimensions. No resize yet: if the picture
    // is already at or under the cap, re-encoding it would cost quality and
    // battery for a file no smaller than the one in hand.
    const loaded = await ImageManipulator.manipulate(uri).renderAsync();
    try {
      if (Math.max(loaded.width, loaded.height) <= LONGEST_SIDE_PX) {
        return { blob: original, mime: fallbackMime };
      }

      // One value only — the other axis follows the ratio. Both values would
      // stretch the picture instead of fitting it.
      const resized = await ImageManipulator.manipulate(loaded)
        .resize(
          loaded.width >= loaded.height
            ? { width: LONGEST_SIDE_PX }
            : { height: LONGEST_SIDE_PX },
        )
        .renderAsync();
      try {
        const saved = await resized.saveAsync({
          compress: WEBP_QUALITY,
          format: SaveFormat.WEBP,
        });
        const shrunk = await (await fetch(saved.uri)).blob();
        // WEBP usually wins, but the only honest rule is the smaller file.
        if (shrunk.size > 0 && shrunk.size < original.size) {
          return { blob: shrunk, mime: 'image/webp' };
        }
      } finally {
        resized.release();
      }
    } finally {
      loaded.release();
    }
  } catch (error) {
    console.warn('[photos] compression skipped, uploading the original file', error);
  }

  return { blob: original, mime: fallbackMime };
}

export const photoKeys = {
  products: (storeId: string | null) => ['product-photos', storeId ?? 'none'] as const,
};

/**
 * Every product on the shelf, active or not: the owner is here to photograph
 * what is standing in front of them. Reading an inactive row needs an admin
 * (RLS, catalog migration); a customer's call would simply come back empty.
 */
export function usePhotoProducts(storeId: string | null) {
  return useQuery<Product[]>({
    queryKey: photoKeys.products(storeId),
    enabled: Boolean(storeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('store_id', storeId as string)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });
}

/**
 * The object path inside `product-images` for one of our public URLs. Public URLs
 * look like `<project>/storage/v1/object/public/product-images/<path>`; anything
 * else (an image hosted elsewhere, or no image) is not ours to delete.
 */
export function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  return decodeURIComponent(url.slice(at + marker.length));
}

/** What `useUploadProductPhoto` needs. */
export type ProductPhotoUpload = {
  storeId: string;
  productId: string;
  /** A local `file://`/`content://` URI from the image picker. */
  uri: string;
  mimeType: string | null;
  /** The URL currently on the row, so the replaced file can be cleaned up. */
  previousImageUrl: string | null;
};

export function useUploadProductPhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProductPhotoUpload) => {
      const mime = input.mimeType && ALLOWED_MIME.includes(input.mimeType)
        ? input.mimeType
        : 'image/jpeg';

      // Compression happens here, on the phone, before anything leaves it.
      const { blob, mime: uploadMime } = await prepareUploadBlob(input.uri, mime);
      if (blob.size > MAX_BYTES) throw new Error('photo_too_large');

      const path = `${input.storeId}/${input.productId}-${Date.now()}.${EXTENSION[uploadMime]}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: uploadMime, upsert: true });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const { error: saveError } = await supabase
        .from('products')
        .update({ image_url: publicUrlData.publicUrl })
        .eq('id', input.productId);
      if (saveError) throw saveError;

      // The old file is unreferenced now. Removing it is housekeeping, so a
      // failure here must not look like a failed upload.
      const oldPath = storagePathFromUrl(input.previousImageUrl);
      if (oldPath && oldPath !== path) {
        const { error: removeError } = await supabase.storage.from(BUCKET).remove([oldPath]);
        if (removeError) console.warn('[photos] could not remove the old file', removeError);
      }

      return publicUrlData.publicUrl;
    },
    onSuccess: async (_url, input) => {
      await queryClient.invalidateQueries({ queryKey: photoKeys.products(input.storeId) });
      // The customer's shop is showing the same row.
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/** Take a photo off the shelf and put the emoji back. */
export function useClearProductPhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      storeId: string;
      productId: string;
      imageUrl: string | null;
    }) => {
      // Clear the pointer first: after this the row can never show a broken
      // image, whatever happens to the file.
      const { error } = await supabase
        .from('products')
        .update({ image_url: null })
        .eq('id', input.productId);
      if (error) throw error;

      const path = storagePathFromUrl(input.imageUrl);
      if (path) {
        const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
        if (removeError) console.warn('[photos] could not remove the file', removeError);
      }
    },
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({ queryKey: photoKeys.products(input.storeId) });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

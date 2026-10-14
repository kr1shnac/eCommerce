import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

      const response = await fetch(input.uri);
      const blob = await response.blob();
      if (blob.size === 0) throw new Error('photo_failed');
      if (blob.size > MAX_BYTES) throw new Error('photo_too_large');

      const path = `${input.storeId}/${input.productId}-${Date.now()}.${EXTENSION[mime]}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: mime, upsert: true });
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

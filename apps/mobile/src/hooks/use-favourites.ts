import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

/**
 * The customer's shortlist.
 *
 * Only the product IDS are fetched, because that is all the UI needs: the
 * product rows themselves already live in the catalogue query, so a heart is
 * one boolean per card and the "Saved" rail is a filter over products we have.
 *
 * Saving is a plain insert; unsaving is a delete. The primary key
 * `(user_id, product_id)` makes a double insert impossible, so a retried tap
 * cannot create a duplicate — it can only fail with 23505, which the optimistic
 * update already hides.
 */

export const favouriteKeys = {
  list: ['favourites'] as const,
};

export function useFavourites(options?: { enabled?: boolean }) {
  const session = useAuthStore((state) => state.session);
  const enabled = (options?.enabled ?? true) && Boolean(session);

  return useQuery<string[]>({
    queryKey: favouriteKeys.list,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('favourites').select('product_id');
      if (error) throw error;
      return (data ?? []).map((row) => row.product_id);
    },
    staleTime: 60_000,
  });
}

type ToggleInput = {
  productId: string;
  /** The state the heart is showing right now. */
  isFavourite: boolean;
};

export function useToggleFavourite() {
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);

  return useMutation({
    mutationFn: async ({ productId, isFavourite }: ToggleInput) => {
      const userId = session?.user.id;
      if (!userId) throw new Error('not_logged_in');

      if (isFavourite) {
        const { error } = await supabase
          .from('favourites')
          .delete()
          .eq('user_id', userId)
          .eq('product_id', productId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('favourites')
          .insert({ user_id: userId, product_id: productId });
        // 23505 means it was already saved (e.g. two quick taps) — that is the
        // desired end state, so it is not an error worth surfacing.
        if (error && error.code !== '23505') throw error;
      }
    },
    // Optimistic, so the heart fills the instant it is tapped. Rolled back
    // cleanly if the write is refused, so the heart never lies (rule 9.4).
    onMutate: async ({ productId, isFavourite }) => {
      await queryClient.cancelQueries({ queryKey: favouriteKeys.list });
      const previous = queryClient.getQueryData<string[]>(favouriteKeys.list);

      queryClient.setQueryData<string[]>(favouriteKeys.list, (old) => {
        const set = new Set(old ?? []);
        if (isFavourite) set.delete(productId);
        else set.add(productId);
        return [...set];
      });

      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(favouriteKeys.list, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: favouriteKeys.list });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import type { Profile, RiderDirectoryEntry, UserRole } from '@/types/database';

/**
 * The signed-in person's profile, and the staff list the owner manages.
 *
 * `profiles.role` is the ONLY thing that decides which face of the app you get.
 * The app reads it; it never writes it except through `useSetRole`, and even
 * then the database (`profiles_guard_role`) refuses unless the caller is an
 * admin. The app is never the authority on role — see ROADMAP §2.
 */

export const profileKeys = {
  me: (userId: string | null) => ['profile', userId ?? 'guest'] as const,
  team: ['profiles', 'team'] as const,
};

export function useProfile() {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery<Profile | null>({
    queryKey: profileKeys.me(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as Profile | null) ?? null;
    },
  });
}

/** Every profile, for the owner's Team screen. RLS hides it from non-admins. */
export function useTeam() {
  return useQuery<Profile[]>({
    queryKey: profileKeys.team,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('role', { ascending: true })
        .order('full_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
}

/**
 * The name, photo and phone of the rider carrying one order, for the customer's
 * order screen — the single highest-trust detail in the app (PRODUCTION.md §10).
 *
 * It reads the `rider_directory` VIEW, not `profiles`, because the profiles
 * policy shows a customer only their own row; the view exposes exactly the four
 * columns a rider is meant to show a customer (migration 20261021000001).
 *
 * Returns null when nobody has claimed the order yet, which is a normal state,
 * not an error — the screen simply does not draw the card.
 */
export function useRider(riderId: string | null) {
  return useQuery<RiderDirectoryEntry | null>({
    queryKey: ['rider', riderId ?? 'none'] as const,
    enabled: Boolean(riderId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rider_directory')
        .select('*')
        .eq('id', riderId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as RiderDirectoryEntry | null) ?? null;
    },
  });
}

/**
 * Change somebody's role. Only an admin can do this; `profiles_guard_role`
 * raises 42501 for everyone else, so a bug in this screen cannot promote a
 * customer to admin.
 */
export function useSetRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { userId: string; role: UserRole }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ role: input.role })
        .eq('id', input.userId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profileKeys.team });
    },
  });
}

/**
 * Name your own account (register H10).
 *
 * WHY THIS EXISTS. Sign-in is a phone number and a code, with no name captured, so
 * `profiles.full_name` is NULL for every customer who signed up through the app —
 * the account screen could show only "Signed in" and the last two digits of the
 * number. On a shared handset (the normal case here: a joint family, one phone)
 * nobody could tell whose account it was.
 *
 * WHY IT GOES THROUGH AN RPC. The same reason the shelf edit does: a plain
 * `.update()` by a caller RLS filters out matches ZERO rows and reports NO error, so
 * a save button built on it can say "Saved" while nothing was saved. `set_my_name()`
 * raises instead, and it takes no user id — it can only ever act on the signed-in
 * person, so there is no id to tamper with and no way to rename somebody else
 * (migration 20261021000006).
 */
export function useSetMyName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fullName: string): Promise<Profile> => {
      const { data, error } = await supabase.rpc('set_my_name', { p_full_name: fullName });
      if (error) throw error;
      return data as unknown as Profile;
    },
    onSuccess: async () => {
      // The profile query is keyed by user id; invalidating the "me" key is what
      // makes the header show the stored name rather than the name that was typed.
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      // The address's `full_name` is a separate row and is NOT touched by this: a
      // shared phone books to whoever the delivery is for, and that name lives on
      // the address, not here. See the household note on the account screen.
    },
  });
}

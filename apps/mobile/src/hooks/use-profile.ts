import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import type { Profile, UserRole } from '@/types/database';

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

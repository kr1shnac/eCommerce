import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '@/lib/supabase';

/**
 * Sign-in is a phone number and a one-time code. No passwords, no email: in a
 * town this size everybody has a phone and nobody remembers a password.
 *
 * The app never sees the code except to type it into Supabase.
 */

type AuthState = {
  session: Session | null;
  user: User | null;
  /** The phone the customer typed, so the code screen knows what to verify. */
  pendingPhone: string | null;
  /** True until we have asked Supabase whether there is already a session. */
  isReady: boolean;
  /** Set by the auth listener, used to re-render when the session changes. */
  onSession: (session: Session | null) => void;
  setReady: () => void;
  setPendingPhone: (phone: string | null) => void;
  sendCode: (phone: string) => Promise<void>;
  verifyCode: (phone: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  pendingPhone: null,
  isReady: false,

  onSession: (session) => set({ session, user: session?.user ?? null }),
  setReady: () => set({ isReady: true }),
  setPendingPhone: (phone) => set({ pendingPhone: phone }),

  sendCode: async (phone) => {
    // `shouldCreateUser: true` means an unknown number becomes a customer on
    // first sign-in. The database creates the profile row via a trigger.
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
    set({ pendingPhone: phone });
  },

  verifyCode: async (phone, token) => {
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });
    if (error) throw error;
    // The listener will pick up the new session; nothing to set by hand.
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
}));

export function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}
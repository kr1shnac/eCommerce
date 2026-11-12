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
  sendCode: (phone: string, captchaToken?: string) => Promise<void>;
  verifyCode: (phone: string, token: string, captchaToken?: string) => Promise<void>;
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

  sendCode: async (phone, captchaToken?) => {
    // `shouldCreateUser: true` means an unknown number becomes a customer on
    // first sign-in. The database creates the profile row via a trigger.
    //
    // The captcha token is optional and only ever present once the shop has
    // configured the gate (see src/lib/captcha.ts). With no site key the call
    // is byte-for-byte what it always was, so nothing changes for a shop that
    // has not set one up.
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true, captchaToken },
    });
    if (error) throw error;
    set({ pendingPhone: phone });
  },

  verifyCode: async (phone, token, captchaToken?) => {
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
      options: { captchaToken },
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
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import type { DeleteAccountResult } from '@/types/database';

/**
 * Deleting your own account.
 *
 * Both app stores require this to be possible from inside the app, and the DPDP
 * Act 2023 gives a data principal the right to erasure. The work itself happens
 * entirely in the database (`public.delete_my_account()`, migration
 * 20261020000001), for three reasons:
 *
 *   1. Removing the `auth.users` row needs the service key, which must never be
 *      in the app (AGENTS.md §4). A `security definer` function keeps it on the
 *      server.
 *   2. It must be one transaction. Half-deleted — addresses gone, account still
 *      there — is worse than not deleted at all.
 *   3. The function takes no arguments, so it is impossible to call it for
 *      somebody else. The app cannot even express that request.
 *
 * The database also refuses two cases the app could never be trusted to decide:
 * a signed-out caller, and the shop's only admin (deleting the last admin locks
 * the owner out of his own panel).
 */

/** The refusal codes `delete_my_account()` raises, in the app's own vocabulary. */
export type DeleteAccountErrorCode =
  | 'not_signed_in'
  | 'only_admin'
  | 'unknown';

/**
 * Turn a Postgres error into the small set of things the screen can say. The
 * raw `message` never reaches a customer (rule 9.2); it is mapped to a code and
 * the UI translates the code.
 */
export class DeleteAccountFailed extends Error {
  readonly code: DeleteAccountErrorCode;

  constructor(code: DeleteAccountErrorCode, message: string) {
    super(message);
    this.name = 'DeleteAccountFailed';
    this.code = code;
  }
}

function classify(message: string, code: string | undefined): DeleteAccountErrorCode {
  // `restrict_violation` (23000) is what the only-admin refusal raises; the
  // message is checked too, because the tombstone guard uses the same code.
  if (message.includes('only admin') || message.includes('add a second admin')) {
    return 'only_admin';
  }
  if (code === 'insufficient_privilege' || message.includes('not signed in')) {
    return 'not_signed_in';
  }
  return 'unknown';
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation<DeleteAccountResult, DeleteAccountFailed, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('delete_my_account');

      if (error) {
        // The message belongs in the console for whoever is debugging; the
        // screen only ever sees the classified code.
        console.warn('[delete_my_account]', error.message);
        throw new DeleteAccountFailed(classify(error.message, error.code), error.message);
      }

      if (!data || typeof data !== 'object') {
        throw new DeleteAccountFailed('unknown', 'bad-delete-account-response');
      }

      return data as DeleteAccountResult;
    },
    onSuccess: async () => {
      // The account is gone. Clear every cached answer that belonged to it
      // BEFORE signing out, so no screen can flash the deleted person's orders
      // on the way to the signed-out state.
      queryClient.clear();
      // Local sign-out only: the server-side user is already deleted, so there
      // is no session to revoke. A failure here would leave a dead token in
      // storage, which the next launch discards anyway.
      await useAuthStore.getState().signOut().catch(() => undefined);
    },
  });
}

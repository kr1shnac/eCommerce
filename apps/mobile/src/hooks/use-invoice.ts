import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { InvoiceResult } from '@/types/database';

/**
 * One order's invoice, from `order_invoice()` (migration 20261112000001).
 *
 * The document is assembled in the database on purpose: the tax on an
 * MRP-inclusive price, the coupon allocated across lines, and the CGST/SGST
 * split all have to agree with the order's own total to the paisa. Computing
 * any of it again in the app would be a second answer waiting to disagree.
 *
 * Only the order's owner or staff can read it; everybody else is told
 * `not_found`, so an order id cannot be probed.
 */
export const invoiceKeys = {
  detail: (orderId: string) => ['orders', orderId, 'invoice'] as const,
};

export function useInvoice(orderId: string | null | undefined, options?: { enabled?: boolean }) {
  return useQuery<InvoiceResult>({
    queryKey: invoiceKeys.detail(orderId ?? ''),
    enabled: (options?.enabled ?? true) && Boolean(orderId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('order_invoice', {
        p_order_id: orderId as string,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object') throw new Error('bad-invoice-response');
      return data as InvoiceResult;
    },
  });
}

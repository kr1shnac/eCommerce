import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { DeliveryZone, Store, StoreSettings } from '@/types/database';

/**
 * The shop, its settings and the pincodes it delivers to.
 *
 * Everything here is for SHOWING the customer a number. The number the customer
 * is actually charged comes from place_order() in the database, which works out
 * the fee again from the same rows. If this screen and that function ever
 * disagree, the database is right.
 */

export const shopKeys = {
  store: ['shop', 'store'] as const,
  settings: ['shop', 'settings'] as const,
  zones: ['shop', 'zones'] as const,
};

export function useStore() {
  return useQuery<Store>({
    queryKey: shopKeys.store,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('no-store');
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useStoreSettings() {
  return useQuery<StoreSettings>({
    queryKey: shopKeys.settings,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_settings')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('no-store-settings');
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

/** Every active delivery zone. There are only a handful, so fetch them all. */
export function useDeliveryZones() {
  return useQuery<DeliveryZone[]>({
    queryKey: shopKeys.zones,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('delivery_zones')
        .select('*')
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

// The fee preview and the free-delivery nudge are pure rules, so they live in
// `lib/delivery.ts` where `check:delivery` can run them without React. Import
// them from there — this module only owns the queries.

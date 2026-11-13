import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type {
  DeliverySettingsResult,
  DeliveryZone,
  Store,
  StoreSettings,
} from '@/types/database';

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

/**
 * Open or close the shop.
 *
 * The write goes through `set_shop_open()` rather than a plain `.update()` for
 * the same reason the shelf does: a non-admin's direct update is filtered by RLS
 * to zero rows and raises nothing, so a button built on it would say "Closed"
 * while the shop stayed open. The RPC raises, and returns the row as stored.
 *
 * The returned row is written straight into the settings cache, so the owner's
 * screen and the customer's checkout see the new state on the next render —
 * including on the same phone, where both faces share one query cache.
 */
export function useSetShopOpen() {
  const queryClient = useQueryClient();

  return useMutation<StoreSettings, Error, boolean>({
    mutationFn: async (isOpen) => {
      const { data, error } = await supabase.rpc('set_shop_open', { p_is_open: isOpen });
      if (error) throw error;
      if (!data) throw new Error('no-store-settings');
      return data;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(shopKeys.settings, settings);
    },
  });
}

// The fee preview and the free-delivery nudge are pure rules, so they live in
// `lib/delivery.ts` where `check:delivery` can run them without React. Import
// them from there — this module only owns the queries.
//
// The same is true of the distance and express rules: they live in `lib/geo.ts`
// and the checkout runs them on the pins it already has, so the answer is
// instant and works on a dead spot. `delivery_quote()` in the database is the
// same rule, tested against the same points; `place_order()` is the authority.

/**
 * The owner's delivery settings: the radius, the express promise, the shop's
 * own pin and the door-pin gate — one RPC, one transaction (migrations
 * 20261112000004 and 20261113000002).
 *
 * A null means "leave this field alone", which is what lets the card send only
 * what changed. The function raises for a non-admin instead of matching zero
 * rows, so a save button cannot report success while saving nothing.
 *
 * Both returned rows are written straight into the cache: the settings AND the
 * store, because the same call may move the shop's pin.
 */
export function useUpdateDeliverySettings() {
  const queryClient = useQueryClient();

  return useMutation<
    DeliverySettingsResult,
    Error,
    {
      deliveryRadiusM?: number | null;
      expressEnabled?: boolean | null;
      expressRadiusM?: number | null;
      expressEtaMinutes?: number | null;
      expressFeePaise?: number | null;
      expressMaxUnits?: number | null;
      lat?: number | null;
      lng?: number | null;
      clearLocation?: boolean;
      addressPinRequired?: boolean | null;
    }
  >({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('update_delivery_settings', {
        p_delivery_radius_m: input.deliveryRadiusM ?? null,
        p_express_enabled: input.expressEnabled ?? null,
        p_express_radius_m: input.expressRadiusM ?? null,
        p_express_eta_minutes: input.expressEtaMinutes ?? null,
        p_express_fee_paise: input.expressFeePaise ?? null,
        p_express_max_units: input.expressMaxUnits ?? null,
        p_lat: input.lat ?? null,
        p_lng: input.lng ?? null,
        p_clear_location: input.clearLocation ?? false,
        p_address_pin_required: input.addressPinRequired ?? null,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object') throw new Error('bad-delivery-settings-response');
      return data as DeliverySettingsResult;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(shopKeys.settings, result.settings);
      queryClient.setQueryData(shopKeys.store, result.store);
    },
  });
}

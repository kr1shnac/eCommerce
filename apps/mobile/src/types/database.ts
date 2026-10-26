/**
 * Hand-written types that mirror supabase/migrations exactly.
 *
 * Regenerate (or extend) this file whenever a migration changes a table.
 * `npx supabase gen types typescript --project-id <ref> --linked` can produce a
 * fuller version later, but this small hand-written version keeps a brand new
 * machine type-safe without running any codegen.
 *
 * MONEY: every `*_paise` column is a whole number of paise.
 */

export type UserRole = 'customer' | 'admin' | 'delivery';
export type OrderStatus =
  | 'placed'
  | 'confirmed'
  | 'packing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  /** A delivery attempt that did not succeed. Terminal. */
  | 'failed'
  /** The bag came back to the shop. Terminal. */
  | 'returned';

/**
 * Why a delivery failed. A fixed list so the customer's screen can render a
 * translated sentence; the rider's own words ride along in `failure_note` for
 * the owner. See migration 20261021000001.
 */
export type FailureReason =
  | 'not_home'
  | 'wrong_address'
  | 'refused'
  | 'unreachable'
  | 'other';
export type PaymentMethod = 'cod' | 'online';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type Store = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  is_active: boolean;
  created_at: string;
  /** 14-digit FSSAI licence. Null until the shop supplies the real one. */
  fssai_number: string | null;
  /** 15-character GSTIN, when the shop is registered. */
  gstin: string | null;
  /** Where a customer complaint reaches a person. Falls back to `phone`. */
  grievance_phone: string | null;
};

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  preferred_language: 'en' | 'kn';
  /** A small profile picture. Used for the rider on the order screen. */
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * What a customer may see about a delivery partner: name, photo and phone, and
 * nothing else. Backed by the `rider_directory` view (migration 20261021000001),
 * because the `profiles` policy would otherwise expose only the customer's own
 * row and would never let an order screen name the rider.
 */
export type RiderDirectoryEntry = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
};

/**
 * The assigned rider's current position, for a customer's own out-for-delivery
 * order (migration 20261026000001). Read from the `order_rider_position` view.
 *
 * The view returns NO ROW at all rather than a flagged row when the fix is
 * stale, too imprecise, or the order is no longer out for delivery — so a
 * consumer of this type can treat a row as showable.
 *
 * `age_seconds`, `distance_m` and `eta_minutes` are computed in Postgres. They
 * are not sent by the app, and a phone with a wrong clock cannot fake them.
 * `distance_m` and `eta_minutes` are null until the delivery address has
 * coordinates.
 */
export type OrderRiderPosition = {
  order_id: string;
  rider_id: string;
  lat: number;
  lng: number;
  recorded_at: string;
  /** Seconds since the server received this fix. */
  age_seconds: number;
  /** Metres from the rider to the delivery door. Null without door coordinates. */
  distance_m: number | null;
  /** Minutes to the door at 5.5 m/s, floored at 3, null beyond 45. */
  eta_minutes: number | null;
};

export type Category = {
  id: string;
  store_id: string;
  name_en: string;
  name_kn: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type Product = {
  id: string;
  store_id: string;
  category_id: string | null;
  name_en: string;
  name_kn: string;
  price_paise: number;
  mrp_paise: number | null;
  unit: string;
  stock_qty: number;
  image_url: string | null;
  /**
   * A picture for the shelf, for shops that have no product photography.
   * `image_url` (a real photo) wins in the UI; this is the fallback, and beats
   * the category's icon. Required for Kunigal, where one in three adults cannot
   * comfortably read the product name (see `DESIGN.md`).
   */
  emoji: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Who packed it. Null means the shop itself. */
  packer_name: string | null;
  /** The declaration as printed on the pack, e.g. "1 kg". Null means `unit`. */
  net_quantity: string | null;
  /**
   * How the shop sells it: `piece` is counted (2 packets, 3 soaps), `measure` is
   * weighed or poured (rice, dal, milk). Presentation only — it never changes how
   * money is computed, because the server ignores client-sent prices entirely.
   */
  sold_by: ProductSoldBy;
  /** The size of ONE pack, in `pack_unit`. Tomato sold as 500 g is (500, 'g'). */
  pack_size: number | null;
  /** The unit `pack_size` is measured in. Null for a plain piece product. */
  pack_unit: PackUnit | null;
};

export type ProductSoldBy = 'piece' | 'measure';
export type PackUnit = 'g' | 'kg' | 'ml' | 'l' | 'piece';

export type Address = {
  id: string;
  user_id: string;
  label: string | null;
  full_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  /**
   * Where the door actually is, for the rider position view's distance and ETA.
   * NULL until the address screen captures it — and while it is NULL no ETA is
   * shown at all, rather than one invented from nothing. `number`, not an
   * integer, because a latitude is a measurement, not money (see migration
   * 20261026000001 for why the paise rule does not apply).
   */
  lat: number | null;
  lng: number | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * A customer's saved product. `(user_id, product_id)` is the primary key, so a
 * product is either saved or it is not — there is no "saved twice". The app
 * toggles by inserting and deleting, never by updating a count.
 */
export type Favourite = {
  user_id: string;
  product_id: string;
  created_at: string;
};

export type CouponKind = 'percent' | 'flat';

/**
 * A discount code the owner runs. RLS hides the whole table from customers —
 * they reach a code only through `validate_coupon()` / `place_order()`
 * (migration 20261014000004), so this type is only ever a staff screen's data.
 *
 * `value` is a percent (1..100) when `kind = 'percent'`, or paise off when
 * `kind = 'flat'`. Every money field is an integer in paise (rule 9.1).
 */
export type Coupon = {
  id: string;
  store_id: string;
  code: string;
  kind: CouponKind;
  value: number;
  /** 0 means "no cap" (percent) or "not used" (flat). */
  max_discount_paise: number;
  min_order_paise: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  /** NULL means unlimited uses. */
  usage_limit: number | null;
  used_count: number;
  description_en: string | null;
  description_kn: string | null;
  created_at: string;
  updated_at: string;
};

export type DeliveryZone = {
  id: string;
  store_id: string;
  pincode: string;
  area_name_en: string | null;
  area_name_kn: string | null;
  /** NULL means "fall back to store_settings.delivery_fee_paise". */
  delivery_fee_paise: number | null;
  eta_minutes: number | null;
  is_active: boolean;
  created_at: string;
};

export type StoreSettings = {
  id: string;
  store_id: string;
  min_order_value_paise: number;
  delivery_fee_paise: number;
  free_delivery_above_paise: number | null;
  open_time: string | null;
  close_time: string | null;
  is_open: boolean;
  support_phone: string | null;
  /** IANA timezone used for the open/closed check. Kunigal is Asia/Kolkata. */
  timezone: string;
  updated_at: string;
  /** The line printed at the bottom of a cash memo. Null means the app's own. */
  receipt_footer: string | null;
};

export type Order = {
  id: string;
  order_number: string;
  user_id: string;
  store_id: string;
  address_id: string | null;
  delivery_address: Record<string, unknown>;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal_paise: number;
  delivery_fee_paise: number;
  discount_paise: number;
  total_paise: number;
  notes: string | null;
  /** Set by the app so a double tap or a retry cannot create a second order. */
  idempotency_key: string | null;
  /** The rider who claimed (or was given) this order. NULL means nobody yet. */
  assigned_to: string | null;
  /** Set together with assigned_to. If one is null the other is too. */
  assigned_at: string | null;
  /**
   * When the rider took the bag from the shop. Distinct from
   * `out_for_delivery`, which can be set at assignment while the bag is still
   * on the counter. Set once, by the assigned rider, and never cleared.
   */
  picked_up_at: string | null;
  /** Why a delivery failed. Required once status is `failed` or `returned`. */
  failure_reason: FailureReason | null;
  /** The rider's own words, for the owner. Not shown to the customer. */
  failure_note: string | null;
  placed_at: string;
  /** When the shop promised this would arrive, from the zone's ETA. */
  estimated_delivery_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name_en: string;
  product_name_kn: string;
  unit: string;
  image_url: string | null;
  price_paise: number;
  quantity: number;
  line_total_paise: number;
};

/**
 * Orders are written by `place_order()` and `cancel_order()` in the database,
 * never by the app. Both come back as one jsonb value so the server can explain
 * a refusal in a form the app can translate.
 */
export type CartLine = { product_id: string; quantity: number };

/** Why place_order() would not place an order. */
export type PlaceOrderError =
  | 'not_logged_in'
  | 'invalid_idempotency_key'
  | 'invalid_items'
  | 'empty_cart'
  | 'address_not_found'
  | 'store_not_found'
  | 'zone_not_served'
  | 'store_closed'
  | 'below_minimum'
  | 'items_unavailable'
  // Coupon refusals. The database decides these, never the app (migration
  // 20261014000004): the customer only ever sends the code.
  | 'coupon_not_found'
  | 'coupon_inactive'
  | 'coupon_not_started'
  | 'coupon_expired'
  | 'coupon_used_up'
  | 'coupon_min_order';

/** A coupon the checkout screen can show before the order is placed. */
export type CouponValidationResult =
  | {
      ok: true;
      code: string;
      discount_paise: number;
      description_en?: string | null;
      description_kn?: string | null;
    }
  | {
      ok: false;
      error: PlaceOrderError | 'empty_code' | 'not_logged_in';
      min_order_paise?: number;
    };

/** A live code shown on the Home offers rail. No usage counts, no secrets. */
export type ActiveOffer = {
  code: string;
  description_en: string | null;
  description_kn: string | null;
  min_order_paise: number;
};

/**
 * One line the shop cannot supply. `available` is what is actually on the shelf:
 * 0 means the customer has to choose a different product.
 */
export type UnavailableItem = {
  product_id: string;
  name_en?: string | null;
  name_kn?: string | null;
  unit?: string | null;
  requested: number;
  available: number;
  reason: 'unavailable' | 'insufficient_stock';
};

export type PlaceOrderResult =
  | {
      ok: true;
      order_id: string;
      order_number: string;
      subtotal_paise?: number;
      delivery_fee_paise?: number;
      discount_paise?: number;
      coupon_code?: string | null;
      total_paise: number;
      /** True when this exact request had already been placed. */
      replayed: boolean;
    }
  | {
      ok: false;
      error: PlaceOrderError;
      items?: UnavailableItem[];
      /** Smallest basket the SHOP accepts. */
      min_order_value_paise?: number;
      /** Smallest basket this COUPON accepts. */
      min_order_paise?: number;
      subtotal_paise?: number;
    };

export type CancelOrderResult =
  | { ok: true; order_id: string; order_number: string }
  | { ok: false; error: 'not_logged_in' | 'order_not_found' | 'cannot_cancel'; status?: OrderStatus };

/**
 * The counts of what `delete_my_account()` actually did. Returned so the app can
 * tell the customer the truth ("we removed your addresses") rather than a vague
 * "done". The database raises instead of returning an error object, so the
 * failure cases here never reach a successful response — they surface as an
 * ApiError from the RPC.
 */
export type DeleteAccountResult = {
  addresses_erased: number;
  orders_anonymised: number;
  accounts_erased: number;
};

/**
 * One day of the shop's takings, from `shop_day_totals()` (migration
 * 20261021000002). Every amount is integer paise, computed in the database.
 *
 * Read the names carefully, because the differences are the point:
 *   * `gross_paise`    — what the day has EARNED: sales only, in flight
 *                        included. A cancelled, failed or returned order is not
 *                        a sale.
 *   * `delivered_paise`— what actually reached a customer's home.
 *   * `cash_in_hand_paise` / `cash_collected_paise` — COD money in riders'
 *                        pockets. A failed COD order appears in neither, because
 *                        that cash was never collected.
 *   * `refund_due_paise`— money the shop HOLDS AND OWES: paid online but never
 *                        delivered. A liability, deliberately not in gross.
 */
export type ShopDayTotals = {
  /** The day, as a `YYYY-MM-DD` date string in the shop's timezone. */
  the_day: string;
  orders_placed: number;
  orders_delivered: number;
  orders_cancelled: number;
  orders_failed: number;
  gross_paise: number;
  delivered_paise: number;
  delivery_fee_paise: number;
  discount_paise: number;
  cash_in_hand_paise: number;
  cash_collected_paise: number;
  refund_due_paise: number;
};

/** One rider's share of a day, from `shop_day_by_rider()`. */
export type RiderDayTotal = {
  rider_id: string | null;
  rider_name: string | null;
  orders_delivered: number;
  cash_to_collect_paise: number;
  cash_collected_paise: number;
};

/**
 * supabase-js expects every table to carry a `Relationships` array; leaving it
 * out makes `.update()` resolve its argument to `never`, which is why writes
 * used to need `as any`. The `orders <-> order_items` pair is declared because
 * the app embeds line items with `select('*, order_items(*)')`; without it that
 * embedded select types as an error.
 */
type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Row>,
  Relationships extends Relationship[] = [],
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

type TableRowMap = {
  stores: Table<Store, Partial<Store> & { name: string; slug: string }>;
  profiles: Table<Profile>;
  categories: Table<Category>;
  products: Table<Product>;
  addresses: Table<Address>;
  favourites: Table<Favourite>;
  coupons: Table<Coupon>;
  delivery_zones: Table<DeliveryZone>;
  store_settings: Table<StoreSettings>;
  orders: Table<Order>;
  order_items: Table<
    OrderItem,
    Partial<OrderItem>,
    Partial<OrderItem>,
    [
      {
        foreignKeyName: 'order_items_order_id_fkey';
        columns: ['order_id'];
        isOneToOne: false;
        referencedRelation: 'orders';
        referencedColumns: ['id'];
      },
    ]
  >;
};

export type Database = {
  public: {
    Tables: TableRowMap;
    Views: {
      /** Name, photo and phone of every rider. Read-only; rider columns only. */
      rider_directory: {
        Row: RiderDirectoryEntry;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * The rider's current position for the caller's own out-for-delivery
       * order, narrowing what the ordering customer may see and nothing more.
       * No row means "nothing showable": stale, too imprecise, or the delivery
       * has ended.
       */
      order_rider_position: {
        Row: OrderRiderPosition;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Functions: {
      place_order: {
        Args: {
          p_items: CartLine[];
          p_store_id: string;
          p_address_id: string;
          p_idempotency_key: string;
          p_note?: string | null;
          p_coupon_code?: string | null;
        };
        Returns: PlaceOrderResult;
      };
      cancel_order: {
        Args: { p_order_id: string };
        Returns: CancelOrderResult;
      };
      /**
       * Read-only coupon check for the checkout preview. The database computes
       * the discount; a use is only counted when place_order() writes the order.
       */
      validate_coupon: {
        Args: { p_store_id: string; p_code: string; p_subtotal_paise: number };
        Returns: CouponValidationResult;
      };
      /** Live codes for the Home offers rail. Safe to call signed out. */
      active_offers: {
        Args: { p_store_id: string };
        Returns: ActiveOffer[];
      };
      /**
       * Make one of the caller's OWN addresses the default, clearing the previous
       * one in the same call. Enforced by a partial unique index, so there can
       * never be two default addresses (migration 20261014000003).
       */
      set_default_address: {
        Args: { p_address_id: string };
        Returns: boolean;
      };
      /**
       * Erase the calling account (DPDP Act 2023 right to erasure, and a store
       * requirement). Deletes the profile, addresses and favourites, anonymises
       * the order history to the tombstone profile so the shop's books survive,
       * and removes the auth user. Takes no arguments, so it can only ever act
       * on the caller. See migration 20261020000001.
       */
      delete_my_account: {
        Args: Record<string, never>;
        Returns: DeleteAccountResult;
      };
      /**
       * The shop's takings for one day, defaulting to today in Asia/Kolkata.
       * Staff only — a customer or a signed-out caller is refused outright, so
       * the publishable key cannot be used to read the shop's money.
       *
       * The database computes these figures, not the app: the owner's board
       * fetches at most 100 orders, so summing those would report a confident,
       * wrong total on any busy day. See migration 20261021000002.
       */
      shop_day_totals: {
        Args: { p_day?: string | null };
        Returns: ShopDayTotals;
      };
      /** One row per rider for a day: deliveries and the cash they hold. */
      shop_day_by_rider: {
        Args: { p_day?: string | null };
        Returns: RiderDayTotal[];
      };
      /**
       * The counter edit: change a product's price, MRP, stock or shelf state
       * from the phone. Staff only.
       *
       * Exists because `supabase.from('products').update(...)` by anyone who is
       * not the shop matches zero rows and raises NO error (RLS filters the row
       * out), so a save button built on it could report success while nothing
       * was saved. This raises instead, and returns the row as it now stands so
       * the screen shows the stored value rather than the intended one.
       *
       * Every parameter except `p_product_id` is optional; a null means "leave
       * this field alone". See migration 20261021000003.
       */
      update_product_from_shop: {
        Args: {
          p_product_id: string;
          p_price_paise?: number;
          p_mrp_paise?: number | null;
          p_stock_qty?: number;
          p_is_active?: boolean;
          p_emoji?: string | null;
          p_sold_by?: ProductSoldBy;
          p_pack_size?: number | null;
          p_pack_unit?: PackUnit | null;
        };
        Returns: Product;
      };
      /**
       * Add a product from the owner's phone. Deliberately takes no `store_id`:
       * the function picks the active shop itself, so a client cannot name one.
       */
      create_product_from_shop: {
        Args: {
          p_name_en: string;
          p_name_kn: string;
          p_price_paise: number;
          p_category_id: string | null;
          p_sold_by?: ProductSoldBy;
          p_pack_size?: number | null;
          p_pack_unit?: PackUnit | null;
          p_mrp_paise?: number | null;
          p_stock_qty?: number;
          p_emoji?: string | null;
        };
        Returns: Product;
      };
      /**
       * Name your own account (register H10). Takes no user id: it acts only on
       * `auth.uid()`, so there is nothing to tamper with and no way to rename
       * somebody else. Refuses a blank name and raises rather than silently
       * doing nothing, so a save button cannot lie.
       */
      set_my_name: {
        Args: { p_full_name: string };
        Returns: Profile;
      };
      /**
       * Record the caller's own position while carrying an order. Deliberately
       * takes no rider id — it acts on `auth.uid()` only, so a rider cannot
       * write a fix for somebody else. Refuses unless the caller is a delivery
       * partner with an `out_for_delivery` order assigned, so an idle rider is
       * never tracked, and there is no direct write path to the table.
       *
       * The client throttles (src/lib/tracking-rules.ts); the server does not,
       * on purpose: a hostile client can only spend its own battery while
       * already carrying a delivery, and a server-side throttle would make the
       * dot drop out exactly when the customer is watching.
       */
      record_my_position: {
        Args: {
          p_lat: number;
          p_lng: number;
          p_accuracy_m?: number | null;
        };
        Returns: Record<string, unknown>;
      };
    };
    Enums: {
      user_role: UserRole;
      order_status: OrderStatus;
      payment_method: PaymentMethod;
      payment_status: PaymentStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
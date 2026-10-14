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
  | 'cancelled';
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
};

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  preferred_language: 'en' | 'kn';
  created_at: string;
  updated_at: string;
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
};

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
  is_default: boolean;
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
  | 'items_unavailable';

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
      total_paise: number;
      /** True when this exact request had already been placed. */
      replayed: boolean;
    }
  | {
      ok: false;
      error: PlaceOrderError;
      items?: UnavailableItem[];
      min_order_value_paise?: number;
      subtotal_paise?: number;
    };

export type CancelOrderResult =
  | { ok: true; order_id: string; order_number: string }
  | { ok: false; error: 'not_logged_in' | 'order_not_found' | 'cannot_cancel'; status?: OrderStatus };

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
    Views: Record<string, never>;
    Functions: {
      place_order: {
        Args: {
          p_items: CartLine[];
          p_store_id: string;
          p_address_id: string;
          p_idempotency_key: string;
          p_note?: string | null;
        };
        Returns: PlaceOrderResult;
      };
      cancel_order: {
        Args: { p_order_id: string };
        Returns: CancelOrderResult;
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
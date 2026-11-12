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
/**
 * What was wrong, after a delivery. Six fixed codes rather than a star rating,
 * because each one maps to a different thing the shop can do about it. See
 * migration 20261106000001.
 */
export type FeedbackReason =
  | 'missing_item'
  | 'damaged'
  | 'late'
  | 'wrong_address'
  | 'wrong_item'
  | 'other';
/**
 * How the customer pays (migration 20261112000002).
 *
 * `online` is the original generic value from the first schema and still means
 * "an online payment of some kind". The specific values are what the checkout
 * offers now, because the shop settles them differently. GPay, PhonePe and
 * Paytm are UPI apps, not separate integrations, so they are all `upi`.
 */
export type PaymentMethod =
  | 'cod'
  | 'upi'
  | 'card'
  | 'netbanking'
  | 'wallet'
  | 'online';
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
  /**
   * Two-digit GST state code (29 = Karnataka). Decides CGST+SGST vs IGST on an
   * invoice. Migration 20261112000001.
   */
  state_code: string;
  /** State name as written in addresses, used to detect an inter-state supply. */
  state_name: string;
  /**
   * The shop's own pin, for the distance rule. Null until the owner drops it;
   * the pincode zone then decides, exactly as before (migration 20261112000004).
   */
  lat: number | null;
  lng: number | null;
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
  /**
   * GST rate in basis points: 0, 500, 1200, 1800 or 2800. The shelf price is
   * INCLUSIVE of this tax, so it is extracted on the invoice, never added.
   * 0 means "not classified yet" and prints as 0% rather than inventing a rate.
   * Migration 20261112000001.
   */
  gst_rate_bp: number;
  /** HSN classification, 4 to 8 digits. Null prints as a dash, never a guess. */
  hsn_code: string | null;
};

/** The five rates an Indian grocery actually uses, in basis points. */
export type GstRateBp = 0 | 500 | 1200 | 1800 | 2800;

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
  /** NULL means no per-person cap. Migration 20261109000004. */
  per_customer_limit: number | null;
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
  /**
   * GST rate applied to the delivery fee, in basis points. 1800 = 18%. Delivery
   * is a service and is taxed as its own line on the invoice.
   */
  delivery_gst_rate_bp: number;
  /**
   * True only when the shop can actually collect an online payment. While it is
   * false the checkout shows the methods greyed with an honest explanation, and
   * `place_order()` refuses them (migration 20261112000003).
   */
  online_payments_enabled: boolean;
  /** How far the shop delivers, in metres. 10000 = 10 km. */
  delivery_radius_m: number;
  express_enabled: boolean;
  /** Express is only promised inside this radius, in metres. */
  express_radius_m: number;
  /** The express promise shown to the customer, in minutes. */
  express_eta_minutes: number;
  /** Extra fee for express, in paise. Added after the free-delivery rule. */
  express_fee_paise: number;
  /** Largest basket (sum of quantities) still promised in express time. */
  express_max_units: number;
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
  /**
   * Money the shop is still holding and owes back: `total_paise` while an
   * online payment remains `paid` on a cancelled, failed or returned order,
   * otherwise 0. Generated by Postgres (migration 20261106000002) — the app
   * never writes it, and marking `payment_status = 'refunded'` clears it.
   */
  refund_due_paise: number;
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
  /**
   * Why the SHOP cancelled this order on the customer's behalf. NULL for every
   * order the customer cancelled themselves, and never changed once written.
   * Migration 20261109000005.
   */
  cancellation_reason: string | null;
  /**
   * `INV/<financial year>/<6-digit serial>`, assigned once on insert by a
   * trigger in IST and never rewritten (migration 20261112000001). The number
   * on the document the customer keeps.
   */
  invoice_number: string | null;
  /** Two-digit state code of the supply, copied from the shop. */
  place_of_supply_state_code: string | null;
  /** True when the delivery state matches the shop's: CGST+SGST, not IGST. */
  is_intra_state: boolean;
  /** The reference the shop recorded when an online payment arrived. */
  payment_reference: string | null;
  /**
   * Which gateway holds the money: NULL (cash, or no gateway connected) or
   * 'razorpay'. Written by `set_order_payment_intent()` — never by the app.
   */
  payment_provider: string | null;
  /**
   * The gateway's own order id (`order_XXX`) for THIS order. One per order: a
   * second, different id would mean two payable objects for one basket.
   * Migration 20261112000006.
   */
  payment_provider_order_id: string | null;
  /** True when the customer paid for the 30-minute promise. */
  is_express: boolean;
  /** The delivery estimate promised at checkout, in minutes. */
  eta_minutes: number | null;
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
  /** The product's rate at the moment of sale, frozen by trigger. */
  gst_rate_bp: number;
  /** The product's HSN at the moment of sale. Null when not recorded. */
  hsn_code: string | null;
};

/**
 * The customer's one answer after a delivered order. `order_id` is the primary
 * key, so there is exactly one per order, and the row is immutable: no update
 * or delete policy exists (migration 20261106000001).
 */
export type OrderFeedback = {
  order_id: string;
  user_id: string;
  was_ok: boolean;
  /** NULL when `was_ok`. Always set when something went wrong. */
  reason: FeedbackReason | null;
  created_at: string;
};

/**
 * One live handover code, as stored (migration 20261106000003). The app never
 * touches this table: it is a mirror for the migration, not a read path.
 */
export type OrderDeliveryCode = {
  order_id: string;
  /** Four digits, leading zeros kept. Plaintext by design, so it can be read back. */
  code: string;
  /** Wrong guesses so far. 5 means locked; only the owner can then close it. */
  attempts: number;
  created_at: string;
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
  // This customer has already used the code `per_customer_limit` times
  // (migration 20261109000004). Cancelled orders do not count.
  | 'coupon_per_customer_limit'
  | 'coupon_min_order'
  // The door is outside the radius the shop delivers to, and both pins exist so
  // the distance is known (migration 20261112000004). The refusal carries
  // `distance_m` and `radius_m` so the app can say how far and how far it
  // delivers.
  | 'outside_delivery_radius'
  // Express was asked for where it cannot be promised: too far, no pin, the
  // basket is too big, or the shop has switched it off.
  | 'express_not_available'
  | 'invalid_payment_method'
  // The shop has not connected a way to collect online money yet.
  | 'online_payment_unavailable';

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
  /** NULL means no shop-wide cap. Migration 20261109000006. */
  usage_limit: number | null;
  /** NULL means no per-person cap. Migration 20261109000004. */
  per_customer_limit: number | null;
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

export type ExpressRefusalReason =
  | 'disabled'
  | 'no_location'
  | 'too_far'
  | 'too_many_items';

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
      /** What the order was actually written as. */
      payment_method?: PaymentMethod;
      is_express?: boolean;
      /** The express fee contained in `delivery_fee_paise`, when express. */
      express_fee_paise?: number;
      eta_minutes?: number | null;
      /** The measured distance to the door, when both pins existed. */
      distance_m?: number | null;
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
      /** Why express was refused: disabled, no_location, too_far, too_many_items. */
      reason?: ExpressRefusalReason;
      /** On `outside_delivery_radius` and `too_far`: the measured distance. */
      distance_m?: number;
      /** On `outside_delivery_radius`: how far the shop delivers. */
      radius_m?: number;
      /** On `too_far`: the express circle. */
      express_radius_m?: number;
      /** On `too_many_items`: the basket and the cap. */
      units?: number;
      max_units?: number;
    };

/**
 * One line of an invoice, as `order_invoice()` computes it. The tax figures are
 * derived in the database from an MRP-inclusive price, so they always satisfy
 * `taxable_paise + tax_paise = net_paise` and the nets add up to the total.
 */
export type InvoiceLine = {
  name_en: string;
  name_kn: string;
  hsn_code: string | null;
  unit: string;
  quantity: number;
  price_paise: number;
  line_total_paise: number;
  /** This line's share of the order's coupon discount. */
  discount_paise: number;
  net_paise: number;
  gst_rate_bp: number;
  taxable_paise: number;
  tax_paise: number;
};

export type InvoiceTotals = {
  subtotal_paise: number;
  discount_paise: number;
  /** Taxable value of the goods AND the delivery line. */
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  tax_paise: number;
  total_paise: number;
  round_off_paise: number;
};

/**
 * The whole document from `order_invoice()` (migration 20261112000001).
 *
 * `is_tax_invoice` is false when the shop has no GSTIN: an unregistered shop
 * issues a bill of supply, and printing CGST on it would be a false document.
 * The app renders whatever this says and never recomputes a tax figure.
 */
export type Invoice = {
  ok: true;
  invoice_number: string;
  order_number: string;
  order_id: string;
  placed_at: string;
  order_status: OrderStatus;
  is_tax_invoice: boolean;
  is_intra_state: boolean;
  place_of_supply_state_code: string | null;
  seller: {
    name: string;
    address_line: string | null;
    city: string | null;
    phone: string | null;
    gstin: string | null;
    fssai_number: string | null;
    state_code: string | null;
  };
  buyer: {
    full_name: string | null;
    phone: string | null;
    line1: string | null;
    line2: string | null;
    landmark: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  payment_reference: string | null;
  is_express: boolean;
  lines: InvoiceLine[];
  delivery: {
    fee_paise: number;
    taxable_paise: number;
    tax_paise: number;
    gst_rate_bp: number;
  };
  totals: InvoiceTotals;
  notes: string | null;
};

export type InvoiceResult = Invoice | { ok: false; error: 'not_logged_in' | 'not_found' };

/**
 * What the checkout is allowed to say BEFORE an order is placed, from
 * `delivery_quote()` (migration 20261112000004). Read-only and about the
 * caller's own address only.
 *
 * `has_fix` false means one of the two pins is missing. The screen then says
 * the distance is not known and falls back to the pincode rule — it never
 * invents a distance or a confident "eligible".
 */
export type DeliveryQuote =
  | {
      ok: true;
      has_fix: boolean;
      distance_m: number | null;
      radius_m: number;
      /** Null when `has_fix` is false: unknown, not "no". */
      within_radius: boolean | null;
      express_available: boolean;
      express_reason: ExpressRefusalReason | null;
      express_eta_minutes: number;
      express_fee_paise: number;
      express_radius_m: number;
      express_max_units: number;
    }
  | { ok: false; error: 'not_logged_in' | 'address_not_found' | 'store_not_found' };

/**
 * The two rows `update_delivery_settings()` returns: the settings as stored and
 * the store (whose pin it may have moved). The screen shows what the database
 * holds, never what it hoped it wrote.
 */
export type DeliverySettingsResult = {
  settings: StoreSettings;
  store: Store;
};

export type CancelOrderResult =
  | { ok: true; order_id: string; order_number: string }
  | { ok: false; error: 'not_logged_in' | 'order_not_found' | 'cannot_cancel'; status?: OrderStatus };

/**
 * The customer's own handover code (`my_delivery_code`, migration
 * 20261106000003). Only the order's customer (or the owner, helping on the
 * phone) can read it, and only while the bag is out for delivery — so
 * `not_available` is an ordinary answer, not a failure.
 *
 * The rider is refused outright (`42501`), which is what makes the code a
 * proof rather than a formality.
 */
export type DeliveryCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: 'not_available' | 'order_not_found' };

/**
 * What the rider's `complete_delivery(order_id, code)` says back. A wrong or
 * locked code is a normal answer (the screen has to say "2 tries left"), so it
 * comes back as data; a permission failure raises.
 */
export type CompleteDeliveryResult =
  | { ok: true; delivered_at: string }
  | {
      ok: false;
      error:
        | 'wrong_code'
        | 'locked'
        | 'invalid_code'
        | 'no_code'
        | 'not_out_for_delivery'
        | 'order_not_found';
      /** Only on `wrong_code` and `invalid_code`. */
      attempts_left?: number;
    };

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
 * How many bags arrived right, and how many did not, from
 * `shop_feedback_totals()` (migration 20261108000001).
 *
 * NOT a rating and not an average. `answered = ok_count + wrong_count` always,
 * and the function returns **no row at all** to a caller who is not staff — so
 * the hook types this as `FeedbackTotals | null` and the screen renders "no
 * answers yet" rather than a confident zero.
 */
export type FeedbackTotals = {
  answered: number;
  ok_count: number;
  wrong_count: number;
};

/** One of the six fixed complaint reasons, and how often it occurred. */
export type FeedbackReasonCount = {
  reason: string;
  seen: number;
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
  /**
   * One immutable answer per delivered order. `Update: never` is deliberate:
   * the table has no update policy (migration 20261106000001), so a write that
   * tries to change an answer would touch zero rows.
   */
  order_feedback: Table<
    OrderFeedback,
    Pick<OrderFeedback, 'order_id' | 'user_id' | 'was_ok'> & {
      reason?: FeedbackReason | null;
    },
    never,
    [
      {
        foreignKeyName: 'order_feedback_order_id_fkey';
        columns: ['order_id'];
        isOneToOne: true;
        referencedRelation: 'orders';
        referencedColumns: ['id'];
      },
    ]
  >;
  /**
   * One live handover code per out-for-delivery order (migration
   * 20261106000003). No client role has a privilege on this table, so it is
   * `never` on every side: the code is read through `my_delivery_code()` and
   * spent through `complete_delivery()`, never by touching the row.
   */
  order_delivery_codes: Table<
    OrderDeliveryCode,
    never,
    never,
    [
      {
        foreignKeyName: 'order_delivery_codes_order_id_fkey';
        columns: ['order_id'];
        isOneToOne: true;
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
      /**
       * Name, photo and phone of the rider assigned to an order the caller may
       * see — not a directory of the shop's staff. Migration 20261112000008
       * scoped the 20261021000001 view: a rider whose only orders belong to
       * somebody else returns no row.
       */
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
          /** Refused unless the shop has switched online payments on. */
          p_payment_method?: PaymentMethod;
          /** The 30-minute promise. Refused with a reason when it cannot be kept. */
          p_express?: boolean;
        };
        Returns: PlaceOrderResult;
      };
      /**
       * The one GST arithmetic in the system. Renders the order as an invoice:
       * lines with tax extracted from the inclusive price, the coupon allocated
       * proportionally, CGST+SGST or IGST, and the grand total. Answers the
       * order's owner or staff only; everybody else gets `not_found`.
       */
      order_invoice: {
        Args: { p_order_id: string };
        Returns: InvoiceResult;
      };
      /**
       * Distance and express eligibility for one of the caller's own addresses,
       * before anything is written. Says `has_fix = false` rather than guessing
       * when a pin is missing.
       */
      delivery_quote: {
        Args: {
          p_store_id: string;
          p_address_id: string;
          p_units?: number | null;
        };
        Returns: DeliveryQuote;
      };
      /**
       * Admin-only: the delivery radius, the express promise and the shop pin,
       * in one transaction. A null means "leave alone". Bounds are checked with
       * messages the owner can act on; a non-admin raises 42501 rather than
       * matching zero rows.
       */
      update_delivery_settings: {
        Args: {
          p_delivery_radius_m?: number | null;
          p_express_enabled?: boolean | null;
          p_express_radius_m?: number | null;
          p_express_eta_minutes?: number | null;
          p_express_fee_paise?: number | null;
          p_express_max_units?: number | null;
          p_lat?: number | null;
          p_lng?: number | null;
          p_clear_location?: boolean;
        };
        Returns: DeliverySettingsResult;
      };
      /**
       * Admin-only: one product's GST rate and HSN. Separate from the daily
       * shelf edit because a rate is a once-a-year classification, and because
       * adding parameters to a function with defaults creates an ambiguous
       * overload. Raises instead of matching zero rows.
       */
      set_product_gst: {
        Args: {
          p_product_id: string;
          p_gst_rate_bp: GstRateBp;
          p_hsn_code?: string | null;
        };
        Returns: Product;
      };
      /**
       * Admin-only: record that an online payment arrived, with its reference.
       * Refuses cash orders and closed orders; a second call returns the stored
       * row unchanged rather than writing twice.
       */
      mark_online_payment_paid: {
        Args: { p_order_id: string; p_reference: string };
        Returns: Order;
      };
      cancel_order: {
        Args: { p_order_id: string };
        Returns: CancelOrderResult;
      };
      /**
       * The caller's own four-digit handover code. Only the order's customer
       * (or the owner, helping on the phone) may read it, and only while the
       * bag is out for delivery. The assigned rider is refused outright, which
       * is what makes the code proof of a handover. See migration
       * 20261106000003.
       */
      my_delivery_code: {
        Args: { p_order_id: string };
        Returns: DeliveryCodeResult;
      };
      /**
       * Close an out-for-delivery order with the customer's code. Assigned
       * rider only; five wrong tries lock the code and the owner finishes the
       * order directly. A wrong code is data, not a crash.
       */
      complete_delivery: {
        Args: { p_order_id: string; p_code: string };
        Returns: CompleteDeliveryResult;
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
       * Open or close the active shop. Takes no store id: the server picks the
       * active shop, so a client cannot close somebody else's. Returns the row
       * as stored, and raises 42501 for a non-admin instead of the silent
       * zero-row no-op a plain `.update()` would produce.
       */
      set_shop_open: {
        Args: { p_is_open: boolean };
        Returns: StoreSettings;
      };
      /**
       * The owner confirms a rider handed over the cash for a delivered COD
       * order. A repeat call returns the row unchanged; a wrong state raises.
       */
      mark_cod_collected: {
        Args: { p_order_id: string };
        Returns: Order;
      };
      /**
       * The owner records that a refund actually left the shop, on an
       * online-paid order that was cancelled, failed or returned. Clears
       * `refund_due_paise`. A repeat call returns the row unchanged.
       */
      mark_refund_paid: {
        Args: { p_order_id: string };
        Returns: Order;
      };
      /**
       * The order's own customer records which gateway order will pay for this
       * basket. One per order: the same id twice is a safe retry, a different
       * id is refused. Never sets `payment_status`.
       */
      set_order_payment_intent: {
        Args: { p_order_id: string; p_provider_order_id: string };
        Returns: Order;
      };
      /**
       * The shop cancels a live order on the customer's behalf: stock back,
       * the reason stored, and every money column untouched. Returns the stored
       * row. Admin-only (42501), refuses a terminal order (P0001) and an
       * unknown one (P0002).
       */
      admin_cancel_order: {
        Args: { p_order_id: string; p_reason?: string | null };
        Returns: Order;
      };
      /**
       * The shop marks a live order delivered — the case where the rider's
       * phone never reported back. Sets `delivered_at` once and never rewrites
       * it. An already-delivered order returns unchanged (safe to retry);
       * cancelled/failed/returned orders are refused (P0001).
       */
      admin_force_complete: {
        Args: { p_order_id: string };
        Returns: Order;
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
      /**
       * Service-role only (or an admin): the gateway has verified the payment,
       * so record it. Refuses cash orders, treats a verified capture on a closed
       * order as a refund liability rather than pretending it never happened,
       * returns the stored row on a retry with the same reference, and raises
       * `23505` on a second, different charge.
       *
       * Called only by the `razorpay-verify` / `razorpay-webhook` Edge Functions,
       * which have already checked Razorpay's HMAC signature. Migration
       * 20261112000006.
       */
      settle_online_payment: {
        Args: { p_order_id: string; p_payment_id: string };
        Returns: Order;
      };
      /**
       * The shop's own answers: two counts over a window (30 days by default).
       * Returns **no row** to anybody who is not staff — the function uses a
       * HAVING for that, so the caller gets `[]` and the screen says "nobody has
       * answered yet" rather than a confident zero.
       */
      shop_feedback_totals: {
        Args: {
          p_since?: string | null;
        };
        Returns: FeedbackTotals[];
      };
      /**
       * Which of the six complaint reasons occurred, most frequent first. A
       * reason that did not occur returns no row at all — never a zero, which
       * would read as "this happened zero times".
       */
      shop_feedback_reasons: {
        Args: {
          p_since?: string | null;
        };
        Returns: FeedbackReasonCount[];
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
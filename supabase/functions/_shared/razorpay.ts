// =============================================================================
// Shared Razorpay helpers for the three Edge Functions.
//
// The secret never leaves this server. The app receives only `key_id`, which is
// public by design, and an `order_XXX` id that is worth nothing without a
// signature made with the secret.
//
// Everything here fails CLOSED: a missing secret is `gateway_not_configured`,
// not a request sent with an empty password.
// =============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** A secret the operator has not set yet. Reported as 503, never as a crash. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value || !value.trim()) throw new ConfigError(`${name} is not set`);
  return value.trim();
}

export function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
  });
}

export function preflight(): Response {
  return new Response('ok', { headers: corsHeaders });
}

/**
 * HMAC-SHA256, lowercase hex. Razorpay signs with the key secret (checkout) or
 * the webhook secret (events); both are the same construction.
 */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison.
 *
 * `a === b` leaks where the first difference is through timing. A signature is
 * attacker-supplied, so it gets the loop: same number of iterations whether the
 * first byte or the last one differs.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}

/** A signed-in customer's client. RLS applies exactly as it does in the app. */
export function createUserClient(req: Request): SupabaseClient | null {
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return null;
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The service-role client. Only ever used for facts the gateway has already
 * proved (a verified signature) and for the two RPCs that are themselves
 * service-role only. Never returned to a caller.
 */
export function createAdminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type RazorpayResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
};

/** A call to Razorpay's REST API, authenticated with the key pair. */
export async function razorpayRequest(
  path: string,
  init: RequestInit = {},
): Promise<RazorpayResult> {
  const keyId = env('RAZORPAY_KEY_ID');
  const keySecret = env('RAZORPAY_KEY_SECRET');
  const authorization = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = { raw: text };
  }

  return { ok: response.ok, status: response.status, body };
}

/** Turn a Razorpay failure into something the app can translate, not a stack. */
export function razorpayFailure(result: RazorpayResult): string {
  const body = result.body ?? {};
  const error = (body.error ?? {}) as Record<string, unknown>;
  return String(error.description ?? error.code ?? `http_${result.status}`);
}

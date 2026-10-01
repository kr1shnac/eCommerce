import * as Sentry from '@sentry/react-native';
import { isRunningInExpoGo } from 'expo';

/**
 * Crash and error reporting.
 *
 * WHY THIS EXISTS. Register H11: there is no crash reporting. In a town where the
 * shop's own phone is the support line, a customer whose app dies gets one
 * option — they stop using it, and the owner never hears why. This is the only
 * way the developer in Bengaluru learns that something breaks on a Redmi 9A in
 * Kunigal, because it will not break on the machine it was written on.
 *
 * WHAT IT SENDS, AND WHY THAT IS OK (read this before changing the DSN rule).
 *
 *   * The DSN is a **write-only ingest key**. It is designed to be shipped in a
 *     client binary; it can only *send* events to one project, and it cannot read
 *     anything back. So putting it in `EXPO_PUBLIC_SENTRY_DSN` is correct and is
 *     NOT the same mistake as putting a Supabase secret in the app (AGENTS §9.6).
 *     It is still not committed to the repo — it goes in `.env`, which is ignored.
 *   * `sendDefaultPii` is **false**. Sentry must not attach IP addresses, and we
 *     never log a customer's name, phone number or delivery address ourselves.
 *     This is a small town; a crash report is not the place to leak a neighbour's
 *     address. Anything we attach deliberately is listed in `beforeSend` below.
 *   * If the DSN is unset, Sentry is simply not started. A developer running
 *     `npm run mobile` with no `.env` gets no reporting and no noise.
 *
 * THE HONEST LIMITATION, and it should not be discovered later. Native crashes
 * (the app dying in Kotlin/Swift) are **not** captured in Expo Go — only
 * JavaScript errors are, and only in development. Full crash reporting needs a
 * development or release build (`eas build`). This is the same wall push
 * notifications and Razorpay hit, and it is recorded in `PRODUCTION.md`.
 */

/** The public, write-only ingestion key. Unset in a fresh checkout. */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Reported as the Sentry environment. `preview` is kept separate from
 * `production` on purpose: a store reviewer's crash should not be filed next to a
 * real customer's, or the signal drowns in the noise.
 */
function environment(): string {
  if (__DEV__) return 'development';
  // A review build carries the reviewer door; see `demo-accounts.ts`. It is a
  // release build, but it is not production.
  if (process.env.EXPO_PUBLIC_REVIEW_EMAIL) return 'preview';
  return 'production';
}

let started = false;

/**
 * Start crash reporting. Safe to call more than once; only the first call does
 * anything. Returns whether reporting is actually on, so a caller (or a test) can
 * tell "not configured" from "configured".
 */
export function startCrashReporting(): boolean {
  if (started) return true;
  if (!DSN) {
    // Not configured — a local checkout, or a build made without the env var.
    // Silence is the right behaviour: a reporting failure must never be a crash.
    return false;
  }

  const inExpoGo = isRunningInExpoGo();

  Sentry.init({
    dsn: DSN,
    environment: environment(),

    // Off. See the note at the top of this file: no IP addresses, ever.
    sendDefaultPii: false,

    // Errors are always captured. Performance traces are sampled lightly because
    // they cost quota, and a grocery shop does not need a full transaction for
    // every tap.
    tracesSampleRate: 0.1,

    // Session tracking tells us how many people hit the crash, not just that one
    // did — which is the difference between a bug and an incident.
    enableAutoSessionTracking: true,

    // Needs native code, so it is off under Expo Go (which the shop's test phone
    // uses today) and on in a real build.
    enableNativeFramesTracking: !inExpoGo,

    /**
     * The last line before an event leaves the phone. Everything that must never
     * leave a customer's device is stripped here, in one place, so there is a
     * single thing to audit rather than a rule scattered across the app.
     */
    beforeSend(event) {
      // A crash report is about our code, not about who the person is. Drop the
      // whole user block rather than trying to redact fields one at a time —
      // redaction is the thing that silently rots. (`setCrashReportingUser` may
      // put an opaque id back; `event.user` here is whatever the SDK inferred.)
      if (event.user && !event.user.id) delete event.user;

      // The request block can carry a query string with an address id in it.
      if (event.request) {
        delete event.request.query_string;
        delete event.request.cookies;
      }

      return event;
    },
  });

  started = true;
  return true;
}

/**
 * Wrap the root component. `Sentry.wrap` installs the error boundary and the
 * touch/navigation instrumentation; without it, an error thrown during render is
 * a white screen rather than a report.
 */
export const wrapWithCrashReporting = Sentry.wrap;

/**
 * Tie reports to the signed-in person — as an opaque id only.
 *
 * We deliberately do **not** set an email or a phone number: that is personal
 * data this app has no reason to put in a crash report (DPDP Act 2023; AGENTS
 * §9.6). The Supabase user id is enough to say "one person hit this five times".
 * Called from the auth listener, and cleared on sign-out.
 */
export function setCrashReportingUser(userId: string | null): void {
  if (!started) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Attach a non-fatal error we caught and handled, e.g. a failed mutation. */
export function reportHandledError(error: unknown, where: string): void {
  if (!started) return;
  Sentry.captureException(error, { tags: { where } });
}

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  captchaOptions,
  captchaProblem,
  captchaTokenLooksValid,
  isCaptchaEnabled,
  type CaptchaProblem,
  type CaptchaToken,
} from '@/lib/captcha';

/**
 * A CAPTCHA token, and the fresh one for the next attempt.
 *
 * The rule this hook exists to enforce: **a token is spent per attempt.**
 *
 * Cloudflare issues single-use tokens that die after five minutes. Both facts
 * break the obvious implementation (ask once, keep it):
 *
 *   * reused — GoTrue refuses it, and the customer is told the captcha failed
 *     for something they never saw;
 *   * too old — the same refusal, but the customer read the screen for four
 *     minutes first.
 *
 * So `requestFresh()` spends the held token and waits for the widget to produce
 * another, which is why it returns a promise rather than a value. When the
 * widget cannot answer (no connection, or Cloudflare down) it times out with
 * `captcha-timeout` — a login screen that spins forever is worse than one that
 * says the check did not load.
 */

/** How long the widget gets to answer before we give up on it. */
export const CAPTCHA_TIMEOUT_MS = 12_000;

/** What the screen mounts, plus the two callbacks the widget calls back into. */
export type CaptchaController = {
  /** The token currently held, fresh or not. */
  token: CaptchaToken | null;
  /** True when the gate is ON, i.e. the caller needs a token. */
  enabled: boolean;
  /** Why the gate has no usable token, for the error box. */
  problem: CaptchaProblem | null;
  /** True while a token is being waited for. */
  waiting: boolean;
  /** Spend the held token and wait for a fresh one. */
  requestFresh: () => Promise<CaptchaToken>;
  /** Filled by `<CaptchaGate>` with `{ reset }`. */
  controlsRef: React.MutableRefObject<{ reset: () => void } | null>;
  /** Called by the widget. Not for the screen. */
  onToken: (token: string) => void;
  onFailure: () => void;
};

type Pending = {
  resolve: (token: CaptchaToken) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function useCaptchaToken(): CaptchaController {
  const [token, setToken] = useState<CaptchaToken | null>(null);
  const [waiting, setWaiting] = useState(false);
  const controlsRef = useRef<{ reset: () => void } | null>(null);
  const pending = useRef<Pending | null>(null);

  /** Abandon any wait, clearing its timer. Safe to call when nothing waits. */
  const failPending = useCallback(() => {
    const current = pending.current;
    pending.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    setWaiting(false);
  }, []);

  const onToken = useCallback(
    (incoming: string) => {
      if (!captchaTokenLooksValid(incoming)) return;
      const fresh: CaptchaToken = { token: incoming.trim(), issuedAt: Date.now() };
      setToken(fresh);

      const current = pending.current;
      pending.current = null;
      if (!current) return;
      clearTimeout(current.timer);
      setWaiting(false);
      current.resolve(fresh);
    },
    [],
  );

  const onFailure = useCallback(() => {
    const current = pending.current;
    failPending();
    if (current) current.reject(new Error('captcha-failed'));
  }, [failPending]);

  const requestFresh = useCallback((): Promise<CaptchaToken> => {
    if (!isCaptchaEnabled()) return Promise.reject(new Error('captcha-not-enabled'));

    // A previous wait is meaningless now, and its timer must not fire later.
    failPending();
    // Spending the held token: the widget will not issue another until reset.
    controlsRef.current?.reset();
    setWaiting(true);

    return new Promise<CaptchaToken>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current = null;
        setWaiting(false);
        reject(new Error('captcha-timeout'));
      }, CAPTCHA_TIMEOUT_MS);
      pending.current = { resolve, reject, timer };
    });
  }, [failPending]);

  // A widget that unmounts mid-wait must not leave the screen spinning.
  useEffect(
    () => () => {
      const current = pending.current;
      pending.current = null;
      if (current) {
        clearTimeout(current.timer);
        current.reject(new Error('captcha-unmounted'));
      }
    },
    [],
  );

  return {
    token,
    enabled: isCaptchaEnabled(),
    problem: captchaProblem(token),
    waiting,
    requestFresh,
    controlsRef,
    onToken,
    onFailure,
  };
}

/** Options for the SDK call, or null when the gate is on and has no token. */
export function captchaAuthOptions(
  controller: CaptchaController,
): { captchaToken: string } | null {
  return captchaOptions(controller.token);
}

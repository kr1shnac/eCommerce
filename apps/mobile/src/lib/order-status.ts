import type { Ionicons } from '@expo/vector-icons';

import type { BadgeTone } from '@/components/ui/badge';
import type { Theme } from '@/constants/theme';
import type { OrderStatus } from '@/types/database';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * One status, one colour, one icon — used by the customer's tracker, the rider's
 * list and the owner's board, so `packing` looks the same everywhere.
 *
 * The colours live in `constants/theme.ts`; this only chooses which token, and
 * which Ionicon, fits each stop. Meaning is carried by the icon as well as the
 * colour, because colour alone fails a colour-blind rider and a low-literacy
 * customer (KUNIGAL.md §2).
 *
 * `color` is the bright fill (dots, tracker nodes). `ink` is the readable text
 * colour to draw on `soft` (the pale wash behind a status badge).
 */
export type StatusStyle = {
  tone: BadgeTone;
  icon: IconName;
  color: string;
  soft: string;
  ink: string;
};

export function orderStatusStyle(theme: Theme, status: OrderStatus): StatusStyle {
  switch (status) {
    case 'placed':
      return {
        tone: 'warning',
        icon: 'receipt-outline',
        color: theme.warning,
        soft: theme.warningSoft,
        ink: theme.warningInk,
      };
    case 'confirmed':
      return {
        tone: 'secondary',
        icon: 'checkmark-done-outline',
        color: theme.secondary,
        soft: theme.secondarySoft,
        ink: theme.secondaryInk,
      };
    case 'packing':
      return {
        tone: 'accent',
        icon: 'bag-handle-outline',
        color: theme.accent,
        soft: theme.accentSoft,
        ink: theme.accent,
      };
    case 'out_for_delivery':
      return {
        tone: 'accent',
        icon: 'bicycle-outline',
        color: theme.accent,
        soft: theme.accentSoft,
        ink: theme.accent,
      };
    case 'delivered':
      return {
        tone: 'success',
        icon: 'home-outline',
        color: theme.success,
        soft: theme.successSoft,
        ink: theme.successInk,
      };
    case 'cancelled':
      return {
        tone: 'danger',
        icon: 'close-circle-outline',
        color: theme.danger,
        soft: theme.dangerSoft,
        ink: theme.dangerInk,
      };
  }
}

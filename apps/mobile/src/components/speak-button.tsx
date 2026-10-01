import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hasKannadaVoice, speakKannada, stopSpeaking } from '@/lib/speech';

/**
 * "Listen" — read this out loud, in Kannada (register H4).
 *
 * ABOUT 31% OF THIS TOWN HAS LOW LITERACY (KUNIGAL.md §3). A price on a screen is
 * a barrier for reasons that have nothing to do with money. This button removes
 * it, using Kannada words the app already has.
 *
 * IT IS HIDDEN WHEN THE PHONE HAS NO KANNADA VOICE, AND THAT IS THE POINT. Almost
 * every phone can be asked to "speak Kannada", and most will answer — by reading
 * Kannada text with an English voice, which is confident nonsense the customer has
 * no way to recognise as wrong. A button that produces gibberish teaches people the
 * app is broken. So the button is **not rendered at all** until the device has
 * confirmed it has a real Kannada voice. Nothing is lost: the price is still on
 * screen, and the shop's phone number is one tap away on every screen.
 *
 * The probe is asynchronous, so the first frame renders no button and it appears a
 * moment later if the voice exists. Showing it and removing it would be worse — a
 * button that vanishes reads as a bug.
 *
 * `accessibilityLabel` is the sentence being read, not "listen", because a screen
 * reader announcing "Listen" tells a blind customer nothing about what they are
 * about to hear.
 */
export function SpeakButton({
  /** The Kannada sentence to read. Already assembled by the caller. */
  text,
  /** What this speaks, for the accessibility label. Already translated. */
  label,
  /** Optional: the sentence to say when there is no Kannada voice. */
  compact = false,
}: {
  text: string;
  label: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    let live = true;
    void hasKannadaVoice().then((ok) => {
      if (live) setAvailable(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  // Stop on unmount, or a customer who taps Listen and immediately goes back
  // leaves a voice reading a product they have walked away from.
  useEffect(() => () => void stopSpeaking(), []);

  const onPress = useCallback(async () => {
    // Toggle: a second tap stops, which is what a customer expects from a
    // speaker button that is still "on".
    if (speaking) {
      await stopSpeaking();
      setSpeaking(false);
      return;
    }

    setSpeaking(true);
    const result = await speakKannada(text, t('speech.noVoice'));
    if (result !== 'spoken' && result !== 'no-voice') setSpeaking(false);
    // A spoken line has no reliable "finished" callback across both platforms that
    // we can trust for state, so the button simply stays lit until tapped again or
    // unmounted. Erring toward "still readable" is safer than erring toward
    // "stopped" while audio is playing.
  }, [speaking, text, t]);

  // Not yet known, or genuinely absent: render nothing.
  if (!available) return null;

  return (
    <Pressable
      onPress={() => void onPress()}
      accessibilityRole="button"
      accessibilityLabel={`${t('speech.listenLabel')}: ${label}`}
      accessibilityState={{ selected: speaking }}
      // 44x44 minimum even though the pill is visually smaller (AGENTS §9.9).
      hitSlop={8}
      style={[
        styles.pill,
        {
          backgroundColor: speaking ? theme.accent : theme.backgroundElement,
          borderColor: theme.border,
        },
      ]}>
      <Ionicons
        name={speaking ? 'volume-high' : 'volume-medium-outline'}
        size={compact ? 14 : 16}
        color={speaking ? theme.onAccent : theme.textSecondary}
      />
      <ThemedText
        type={compact ? 'caption' : 'smallBold'}
        style={{ color: speaking ? theme.onAccent : theme.text }}>
        {speaking ? t('speech.stop') : t('speech.listen')}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 999,
    borderWidth: 1,
  },
});

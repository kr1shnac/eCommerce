import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { kannadaInputFont } from '@/constants/fonts';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import {
  useClearProductPhoto,
  usePhotoProducts,
  useUploadProductPhoto,
} from '@/hooks/use-product-photos';
import { useStore } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useLanguageStore } from '@/store/language-store';
import type { Product } from '@/types/database';

/**
 * The shelf, photograph by photograph.
 *
 * A real photo of the actual packet beats a word for a reader who reads slowly
 * (`DESIGN.md`), and it beats the emoji fallback for everyone. The owner is the
 * only one who can take it, so the tool has to be in the phone, at the shelf —
 * the web panel's drag-and-drop is for a desk they do not have.
 *
 * The photo itself is just `products.image_url`, written after the file lands in
 * the public `product-images` bucket. RLS on both the bucket and the table allows
 * only an admin to write (`use-product-photos.ts`).
 */
export default function AdminPhotosScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const language = useLanguageStore((state) => state.language);

  const store = useStore();
  const storeId = store.data?.id ?? null;
  const products = usePhotoProducts(storeId);
  const upload = useUploadProductPhoto();
  const clearPhoto = useClearProductPhoto();

  const [term, setTerm] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const list = useMemo(() => {
    const all = products.data ?? [];
    const needle = term.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((product) =>
      `${product.name_en} ${product.name_kn ?? ''}`.toLowerCase().includes(needle),
    );
  }, [products.data, term]);

  /**
   * Where the next picture comes from. Camera first: the packet is in the
   * owner's hand, so taking the photo is one tap shorter than finding one.
   */
  const askSource = (product: Product) => {
    Alert.alert(t('admin.photoAddTitle'), t('admin.photoAddHint'), [
      { text: t('admin.photoCamera'), onPress: () => void takePhoto(product, 'camera') },
      { text: t('admin.photoLibrary'), onPress: () => void takePhoto(product, 'library') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const takePhoto = async (product: Product, source: 'camera' | 'library') => {
    if (!storeId) return;
    setErrorKey(null);

    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setErrorKey('admin.photoPermission');
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        // Cropping to a square means the picture files under any layout without
        // being squeezed, and it re-encodes HEIC to JPEG on iOS.
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      await upload.mutateAsync({
        storeId,
        productId: product.id,
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        previousImageUrl: product.image_url,
      });
    } catch (error) {
      console.warn('[photos] could not save the photo', error);
      const message = error instanceof Error ? error.message : '';
      setErrorKey(message === 'photo_too_large' ? 'admin.photoTooLarge' : 'admin.photoError');
    }
  };

  const confirmRemove = (product: Product) => {
    Alert.alert(t('admin.photoRemoveTitle'), t('admin.photoRemoveHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.photoRemove'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!storeId) return;
            setErrorKey(null);
            try {
              await clearPhoto.mutateAsync({
                storeId,
                productId: product.id,
                imageUrl: product.image_url,
              });
            } catch (error) {
              console.warn('[photos] could not remove the photo', error);
              setErrorKey('admin.photoRemoveError');
            }
          })();
        },
      },
    ]);
  };

  const renderProduct = ({ item }: { item: Product }) => {
    const busy = upload.isPending && upload.variables?.productId === item.id;
    const name = localizedName(item);
    const hasPhoto = Boolean(item.image_url);

    return (
      <Card style={styles.card}>
        <Pressable
          onPress={() => askSource(item)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={
            hasPhoto
              ? t('admin.photoChangeLabel', { name })
              : t('admin.photoAddLabel', { name })
          }
          style={styles.tapArea}>
          <View style={[styles.thumbBox, { backgroundColor: theme.backgroundElement }]}>
            {hasPhoto ? (
              <Image
                source={{ uri: item.image_url ?? '' }}
                style={styles.thumb}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <ThemedText style={styles.emoji}>{item.emoji ?? '🛒'}</ThemedText>
            )}
            {busy ? (
              <View style={[styles.busyOverlay, { backgroundColor: theme.overlay }]}>
                <View style={[styles.busyChip, { backgroundColor: theme.card }]}>
                  <ActivityIndicator color={theme.accent} />
                </View>
              </View>
            ) : null}
          </View>

          <View style={styles.info}>
            <ThemedText type="bodyStrong" numberOfLines={2}>
              {name}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {item.unit}
            </ThemedText>
            <View style={styles.badgeRow}>
              {hasPhoto ? (
                <Badge label={t('admin.photoHas')} tone="success" icon="checkmark-circle" />
              ) : (
                <Badge label={t('admin.photoNone')} tone="neutral" icon="image-outline" />
              )}
              {!item.is_active ? (
                <Badge label={t('admin.photoOff')} tone="warning" icon="eye-off-outline" />
              ) : null}
            </View>
          </View>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            onPress={() => askSource(item)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={
              hasPhoto
                ? t('admin.photoChangeLabel', { name })
                : t('admin.photoAddLabel', { name })
            }
            style={({ pressed }) => [
              styles.actionButton,
              { borderColor: theme.accentBorder, backgroundColor: theme.accentSoft },
              pressed && styles.pressed,
            ]}>
            <Ionicons name="camera-outline" size={18} color={theme.accent} />
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {hasPhoto ? t('admin.photoChange') : t('admin.photoAdd')}
            </ThemedText>
          </Pressable>

          {hasPhoto ? (
            <IconButton
              icon="trash-outline"
              label={t('admin.photoRemoveLabel', { name })}
              color={theme.danger}
              onPress={() => confirmRemove(item)}
              disabled={busy}
            />
          ) : null}
        </View>
      </Card>
    );
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <OfflineBanner />

      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <ThemedText type="title">{t('admin.photosTitle')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('admin.photosHint')}
        </ThemedText>

        <View
          style={[
            styles.searchBar,
            Elevation.card,
            { backgroundColor: theme.card, borderColor: theme.border, shadowColor: theme.shadow },
          ]}>
          <Ionicons name="search" size={20} color={theme.textSecondary} />
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.photoSearch')}
            placeholderTextColor={theme.textTertiary}
            style={[styles.searchInput, kannadaInputFont(language), { color: theme.text }]}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={t('admin.photoSearch')}
          />
          {term.length > 0 ? (
            <Pressable
              onPress={() => setTerm('')}
              accessibilityRole="button"
              accessibilityLabel={t('home.clearSearch')}>
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {errorKey ? (
        <View style={styles.errorSlot}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
          <ThemedText type="small" style={{ color: theme.danger }}>
            {t(errorKey)}
          </ThemedText>
        </View>
      ) : null}

      {store.isLoading || products.isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderProduct}
          extraData={language}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + Spacing.five },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={products.isRefetching}
              onRefresh={() => void products.refetch()}
              tintColor={theme.accent}
            />
          }
          ListEmptyComponent={
            products.isError || store.isError ? (
              <StateMessage
                title={t('admin.photosError')}
                hint={t('admin.photosErrorHint')}
                onRetry={() => void (store.isError ? store.refetch() : products.refetch())}
              />
            ) : term.trim() ? (
              <StateMessage title={t('admin.photosNoMatch')} hint={t('admin.photosNoMatchHint')} art="🔍" />
            ) : (
              <StateMessage
                title={t('admin.photosEmpty')}
                hint={t('admin.photosEmptyHint')}
                art="📷"
              />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 16, lineHeight: 22, paddingVertical: Spacing.two },
  errorSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  card: { gap: Spacing.two },
  tapArea: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  thumbBox: {
    width: 72,
    height: 72,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  emoji: { fontSize: 30, lineHeight: 38 },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Sits on the dim overlay, so it carries its own surface. */
  busyChip: {
    width: 36,
    height: 36,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: Spacing.one },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.7 },
});

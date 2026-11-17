import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback } from 'react';

import type { RootParamList } from './routes';

/**
 * Navigation hooks for the screens. Kept apart from `navigation.tsx` (which imports every screen) so screens can
 * use them without an import cycle.
 */

export type AppNavigation = NativeStackNavigationProp<RootParamList>;

export function useAppNavigation(): AppNavigation {
  return useNavigation<AppNavigation>();
}

/** Back button behaviour: go back, or to Home when the screen was opened directly (web deep link, cold start). */
export function useBack(): () => void {
  const navigation = useAppNavigation();
  return useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    }
  }, [navigation]);
}

/** Replaces the whole stack with Home (end of onboarding, end of a ride). */
export function useGoHome(): () => void {
  const navigation = useAppNavigation();
  return useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation]);
}

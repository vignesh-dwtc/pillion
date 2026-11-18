import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DevPanel } from '../features/devpanel/DevPanel';
import { AppText } from '../features/components/AppText';
import { Ornament } from '../features/components/Rule';

import { appStore } from './composition';
import { FONT_MAP } from './fonts';
import { useAppStore } from './hooks';
import { AppNavigation } from './navigation';
import { strings } from './strings';
import { colors, spacing } from './theme';

/** If the Keystore does not answer in time the app opens anyway, as "no pairing yet". */
const HYDRATION_TIMEOUT_MS = 2500;

export default function App() {
  const pairingsStatus = useAppStore((s) => s.pairingsStatus);
  const [timedOut, setTimedOut] = useState(false);
  // Bundled fonts (offline). On failure `fontError` is set and the system font is used: never block the app.
  const [fontsLoaded, fontError] = useFonts(FONT_MAP);

  useEffect(() => {
    void appStore.getState().refreshPairings();
    const timer = setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const fontsSettled = fontsLoaded || fontError !== null || timedOut;
  const ready = (pairingsStatus !== 'loading' || timedOut) && fontsSettled;

  return (
    <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      {ready ? <AppNavigation /> : <Splash />}
      <DevPanel />
    </SafeAreaProvider>
  );
}

function Splash() {
  return (
    <View
      testID="screen-splash"
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
      }}
    >
      <AppText variant="wordmark">{strings.appName}</AppText>
      <Ornament />
    </View>
  );
}

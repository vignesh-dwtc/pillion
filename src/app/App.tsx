import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import IDENTITY from '../../config/identity.json';
import { DevPanel } from '../features/devpanel/DevPanel';
import { AppText } from '../features/components/AppText';

import { appStore } from './composition';
import { useAppStore } from './hooks';
import { AppNavigation } from './navigation';
import { colors } from './theme';

/** If the Keystore does not answer in time the app opens anyway, as "no pairing yet". */
const HYDRATION_TIMEOUT_MS = 2500;

export default function App() {
  const pairingsStatus = useAppStore((s) => s.pairingsStatus);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    void appStore.getState().refreshPairings();
    const timer = setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = pairingsStatus !== 'loading' || timedOut;

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
      style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <AppText variant="display">{IDENTITY.displayName}</AppText>
    </View>
  );
}

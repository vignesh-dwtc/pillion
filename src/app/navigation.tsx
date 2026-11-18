import {
  DarkTheme,
  NavigationContainer,
  getStateFromPath,
  type LinkingOptions,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Platform } from 'react-native';

import IDENTITY from '../../config/identity.json';
import { DebugScreen } from '../features/debug/DebugScreen';
import { DiagnosticsScreen } from '../features/diagnostics/DiagnosticsScreen';
import { HomeScreen } from '../features/home/HomeScreen';
import { OnboardingScreen } from '../features/onboarding/OnboardingScreen';
import { PairGuestScreen } from '../features/pair/PairGuestScreen';
import { PairHostScreen } from '../features/pair/PairHostScreen';
import { RideScreen } from '../features/ride/RideScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';

import { appStore } from './composition';
import {
  ROUTE_PATHS,
  isRootPath,
  resolveInitialRoute,
  type RootParamList,
  type StartupState,
} from './routes';
import { strings } from './strings';
import { colors } from './theme';

const Stack = createNativeStackNavigator<RootParamList>();

export const navigationTheme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: colors.brass,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.vermilion,
  },
};

function startupState(): StartupState {
  const { onboardingDone, pairings } = appStore.getState();
  return { onboardingDone, hasPairing: pairings.length > 0 };
}

/**
 * Deep links. The paths are the web routes the Playwright smoke test opens (routes.ts). '/' (and a normal launch)
 * resolves to Home, or to Onboarding on a brand-new install; every other path opens its screen directly.
 */
export const linking: LinkingOptions<RootParamList> = {
  prefixes: [`${IDENTITY.urlScheme}://`],
  config: { screens: ROUTE_PATHS },
  getStateFromPath(path, options) {
    if (isRootPath(path)) {
      return { routes: [{ name: resolveInitialRoute(startupState()) }] };
    }
    return getStateFromPath(path, options);
  },
};

export function AppNavigation() {
  // Decided once, after the stores are hydrated (App renders this only then).
  const [initialRoute] = useState(() => resolveInitialRoute(startupState()));

  return (
    <NavigationContainer
      linking={linking}
      theme={navigationTheme}
      documentTitle={{
        formatter: (options, route) => {
          const title = options?.title ?? route?.name ?? '';
          // The home title is the product name already: do not repeat it.
          return title === IDENTITY.displayName ? title : `${title} · ${IDENTITY.displayName}`;
        },
      }}
    >
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: Platform.OS === 'web' ? 'none' : 'fade',
        }}
      >
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ title: strings.onboarding.title }}
        />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: IDENTITY.displayName }} />
        <Stack.Screen
          name="PairHost"
          component={PairHostScreen}
          options={{ title: strings.pairHost.title }}
        />
        <Stack.Screen
          name="PairGuest"
          component={PairGuestScreen}
          options={{ title: strings.pairGuest.title }}
        />
        <Stack.Screen name="Ride" component={RideScreen} options={{ title: strings.ride.title }} />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: strings.settings.title }}
        />
        <Stack.Screen
          name="Diagnostics"
          component={DiagnosticsScreen}
          options={{ title: strings.diagnostics.title }}
        />
        <Stack.Screen name="Debug" component={DebugScreen} options={{ title: strings.debug.title }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

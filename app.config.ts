import type { ConfigContext, ExpoConfig } from 'expo/config';

import IDENTITY from './config/identity.json';

/**
 * Android SDK levels. Only minSdk is overridden (29: required by the Wi-Fi Direct join-with-credentials API).
 * compileSdk (37), targetSdk (36), build-tools (37.0.0) and NDK (27.1.12297006) are React Native 0.88 / Expo SDK 58
 * defaults on purpose: Expo SDK 58 libraries refuse to build below compileSdk 37, and targetSdk 36 is what the
 * platform ships and tests. See docs/DECISIONS.md D-010.
 */
const ANDROID_MIN_SDK = 29;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IDENTITY.displayName,
  slug: IDENTITY.slug,
  scheme: IDENTITY.urlScheme,
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0B0A08',
  android: {
    package: IDENTITY.androidApplicationId,
    adaptiveIcon: {
      backgroundColor: '#0B0A08',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
  plugins: [
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: ANDROID_MIN_SDK,
          // Ride-test release APK (assembleRelease): realistic performance, debug-signed, readable stack traces.
          enableMinifyInReleaseBuilds: false,
        },
      },
    ],
    'expo-secure-store',
    // Debug variant embeds the JS bundle so the CI APK runs without Metro (docs/DECISIONS.md D-009).
    './plugins/withEmbeddedBundle',
  ],
});

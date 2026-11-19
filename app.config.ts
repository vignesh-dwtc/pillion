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
  // No `scheme`: a registered BROWSABLE `<urlScheme>://` filter would let any web page launch the app into any screen,
  // and nothing on Android needs it yet (pairing scans the QR in-app). See docs/DECISIONS.md D-045.
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
    // Least privilege (docs/DECISIONS.md D-045). Removed from the merged manifest of every variant: storage access
    // (expo-file-system/expo-camera defaults; nothing reads or writes shared storage, and no audio is ever stored) and
    // the RN dev-menu overlay. The debug-only android/app/src/debug manifest may still add SYSTEM_ALERT_WINDOW.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    // No Auto Backup to the cloud: pairing records must not leave the phone. expo-secure-store's data extraction rules
    // stay in place for device-to-device transfer (which allowBackup=false does not disable on Android 12+).
    allowBackup: false,
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

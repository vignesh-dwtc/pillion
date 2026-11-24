import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { permissionService } from '../../app/composition';
import { strings } from '../../app/strings';
import { colors, spacing } from '../../app/theme';
import { AppText } from '../components/AppText';
import { useAppActive } from '../components/motion/useAppActive';
import { Plate } from '../components/Plate';

import { Viewfinder } from './Viewfinder';

/** Native build: the phone has a camera. The web twin sets this to false and the paste field becomes the only path. */
export const CAMERA_SCANNING_AVAILABLE: boolean = true;

export interface QrScannerProps {
  size: number;
  /** False while a scan is being handled or after success: the camera stays on, decoding stops. */
  active: boolean;
  onScan: (data: string) => void;
}

const QR_ONLY = { barcodeTypes: ['qr' as const] };

/**
 * Camera permission flow and live QR scanner (expo-camera). The explanation comes first and the system prompt only
 * when the user taps "Allow camera"; a denial can be asked again, a block ("don't ask again") links to the system
 * settings. The permission is re-read whenever the app returns to the foreground (back from the settings app).
 * The camera only decodes QR codes and nothing is recorded. Untested on a device (docs/TESTING.md).
 */
export function QrScanner({ size, active, onScan }: QrScannerProps) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const appActive = useAppActive();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (appActive) void getPermission().catch(() => undefined);
  }, [appActive, getPermission]);

  const ask = useCallback(() => {
    setAsking(true);
    requestPermission()
      .catch(() => undefined)
      .finally(() => setAsking(false));
  }, [requestPermission]);

  const onBarcodeScanned = useCallback((result: BarcodeScanningResult) => onScan(result.data), [onScan]);

  if (permission?.granted) {
    return (
      <Viewfinder
        testID="viewfinder"
        size={size}
        accessibilityLabel={strings.pairGuest.viewfinderLabel}
        live={
          appActive ? (
            <CameraView
              testID="camera-preview"
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={QR_ONLY}
              onBarcodeScanned={active ? onBarcodeScanned : undefined}
            />
          ) : (
            <View style={{ flex: 1, backgroundColor: colors.face }} />
          )
        }
      />
    );
  }

  if (!permission) {
    return (
      <Viewfinder
        testID="viewfinder"
        size={size}
        title={strings.pairGuest.cameraChecking}
        accessibilityLabel={strings.pairGuest.cameraChecking}
      />
    );
  }

  const blocked = !permission.canAskAgain;
  const firstTime = permission.status === 'undetermined';
  const title = blocked
    ? strings.pairGuest.cameraBlockedTitle
    : firstTime
      ? strings.pairGuest.cameraAskTitle
      : strings.pairGuest.cameraDeniedTitle;
  const body = blocked
    ? strings.pairGuest.cameraBlocked
    : firstTime
      ? strings.pairGuest.cameraAskBody
      : strings.pairGuest.cameraDenied;

  return (
    <View
      testID={firstTime ? 'camera-ask' : 'camera-denied'}
      style={{ alignItems: 'stretch', gap: spacing.md }}
    >
      <Viewfinder
        size={Math.min(size, 240)}
        icon={blocked || !firstTime ? 'warning-triangle' : 'camera'}
        title={title}
        accessibilityLabel={title}
      />
      <AppText variant="body" align="center" color={colors.textMuted}>
        {body}
      </AppText>
      {blocked ? (
        <Plate
          testID="btn-camera-settings"
          label={strings.pairGuest.openSettings}
          icon="gear"
          onPress={() => void permissionService.openSettings().catch(() => undefined)}
        />
      ) : (
        <Plate
          testID="btn-camera-allow"
          label={strings.pairGuest.cameraAllow}
          icon="camera"
          disabled={asking}
          onPress={ask}
        />
      )}
    </View>
  );
}

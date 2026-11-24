import { strings } from '../../app/strings';

import type { QrScannerProps } from './QrScanner';
import { Viewfinder } from './Viewfinder';

/**
 * Web twin of QrScanner: the web verification build has no camera scanning, so this shows an empty viewfinder that
 * says so, and the guest screen offers the paste field instead (the same decode path as a scanned plate).
 */
export const CAMERA_SCANNING_AVAILABLE: boolean = false;

export function QrScanner({ size }: QrScannerProps) {
  return (
    <Viewfinder
      testID="viewfinder"
      size={size}
      title={strings.pairGuest.noCameraTitle}
      note={strings.pairGuest.noCameraBody}
      accessibilityLabel={strings.pairGuest.noCameraTitle}
    />
  );
}

import type { ReactElement } from 'react';

/**
 * Web-only developer panel (headset disconnected, link dropped, phone call started). On native it renders nothing.
 * `DevPanel.web.tsx` (owned by `web-verify`) sits next to this file and Metro picks it on web; it must export
 * the same `DevPanel` name. Mounted once at the app root.
 */
export function DevPanel(): ReactElement | null {
  return null;
}

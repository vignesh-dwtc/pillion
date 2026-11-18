import { memo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../../app/theme';

/**
 * Engraved line icons on a 24 grid: stroke 1.6, round caps and joins, no fill except the battery level. Drawn in
 * code with react-native-svg (no icon font, no emoji, identical on Android and web). Default colour is brass; state
 * icons take their tone colour. Icons are decorative: the text or control next to them carries the accessible
 * name, and no state is conveyed by an icon alone.
 *
 * Sizes: 16 inline, 20 in rows, 24 in buttons, 28-30 on ride plates.
 */
export type IconName =
  | 'gear'
  | 'headset'
  | 'link'
  | 'shield-check'
  | 'key'
  | 'chevron'
  | 'back'
  | 'qr'
  | 'pulse'
  | 'mic'
  | 'mic-off'
  | 'stop'
  | 'check'
  | 'cross'
  | 'battery'
  | 'wifi-direct'
  | 'moon'
  | 'bell'
  | 'camera'
  | 'phone'
  | 'warning-triangle'
  | 'flag'
  | 'wrench'
  | 'plus'
  | 'minus'
  | 'motorcycle'
  | 'bluetooth'
  | 'info'
  | 'share'
  | 'reset';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Battery fill, 0..1 (battery icon only). */
  level?: number;
}

export const Icon = memo(function Icon({
  name,
  size = 24,
  color = colors.brass,
  strokeWidth = 1.6,
  level,
}: IconProps) {
  const s = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  } as const;
  return (
    <View
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {renderShape(name, s, color, level)}
      </Svg>
    </View>
  );
});

type StrokeProps = {
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  fill: 'none';
};

function renderShape(name: IconName, s: StrokeProps, color: string, level?: number) {
  switch (name) {
    case 'gear':
      return (
        <>
          <Circle cx="12" cy="12" r="6" {...s} />
          <Circle cx="12" cy="12" r="2.2" {...s} />
          <Path
            d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"
            {...s}
          />
        </>
      );
    case 'headset':
      return (
        <>
          <Path d="M4.5 15.5V12a7.5 7.5 0 0 1 15 0v3.5" {...s} />
          <Path d="M4.5 14h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-.5a1.5 1.5 0 0 1-1.5-1.5z" {...s} />
          <Path d="M19.5 14h-2a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h.5a1.5 1.5 0 0 0 1.5-1.5z" {...s} />
        </>
      );
    case 'link':
      return (
        <>
          <Path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" {...s} />
          <Path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" {...s} />
        </>
      );
    case 'shield-check':
      return (
        <>
          <Path d="M12 3l7 2.8v5.7c0 4.4-2.9 7.9-7 9.5-4.1-1.6-7-5.1-7-9.5V5.8z" {...s} />
          <Path d="M9 12.2l2.1 2.1 4-4.3" {...s} />
        </>
      );
    case 'key':
      return (
        <>
          <Circle cx="8" cy="16" r="3.8" {...s} />
          <Path d="M10.7 13.3L20 4M16.6 7.4l2.4 2.4M14.3 9.7l1.8 1.8" {...s} />
        </>
      );
    case 'chevron':
      return <Path d="M9.5 5.5L16 12l-6.5 6.5" {...s} />;
    case 'back':
      return <Path d="M19 12H5.5M11 5.5L4.5 12l6.5 6.5" {...s} />;
    case 'qr':
      return (
        <>
          <Rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" {...s} />
          <Rect x="14" y="3.5" width="6.5" height="6.5" rx="1" {...s} />
          <Rect x="3.5" y="14" width="6.5" height="6.5" rx="1" {...s} />
          <Path d="M14 14h2.5v2.5H14zM20.5 14v6.5M14 20.5h3.5M6.75 6.75h0M17.25 6.75h0M6.75 17.25h0" {...s} />
        </>
      );
    case 'pulse':
      return <Path d="M2.5 12h4l2.2-5.5 4.6 11 2.3-5.5h5.9" {...s} />;
    case 'mic':
      return (
        <>
          <Rect x="9" y="3" width="6" height="11" rx="3" {...s} />
          <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" {...s} />
        </>
      );
    case 'mic-off':
      return (
        <>
          <Path d="M15 10.5V6a3 3 0 0 0-5.8-1.1M9 9v2a3 3 0 0 0 4.9 2.3" {...s} />
          <Path d="M18.5 11a6.5 6.5 0 0 1-.9 3.3M5.5 11a6.5 6.5 0 0 0 10.4 5.2M12 17.5V21M9 21h6" {...s} />
          <Path d="M4 4l16 16" {...s} />
        </>
      );
    case 'stop':
      return <Rect x="6.5" y="6.5" width="11" height="11" rx="1.5" {...s} />;
    case 'check':
      return <Path d="M5 12.5l4.5 4.5L19 7.5" {...s} />;
    case 'cross':
      return <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...s} />;
    case 'battery': {
      const fill = Math.max(0, Math.min(1, level ?? 0.75));
      return (
        <>
          <Rect x="2.5" y="7" width="17" height="10" rx="2" {...s} />
          <Path d="M21.5 10.5v3" {...s} />
          {fill > 0 ? <Rect x="4.5" y="9" width={13 * fill} height="6" rx="0.8" fill={color} /> : null}
        </>
      );
    }
    case 'wifi-direct':
      return (
        <>
          <Rect x="2.5" y="7" width="5" height="10.5" rx="1.2" {...s} />
          <Rect x="16.5" y="7" width="5" height="10.5" rx="1.2" {...s} />
          <Path d="M10.4 13.6a2.3 2.3 0 0 1 3.2 0M9.2 11.2a4 4 0 0 1 5.6 0" {...s} />
          <Path d="M12 16.2h0" {...s} />
        </>
      );
    case 'moon':
      return <Path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.2 6.2 0 0 0 10 10z" {...s} />;
    case 'bell':
      return (
        <>
          <Path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z" {...s} />
          <Path d="M10 21a2.2 2.2 0 0 0 4 0M12 3v2.5" {...s} />
        </>
      );
    case 'camera':
      return (
        <>
          <Path d="M3.5 8.5h3.2l1.6-2.5h7.4l1.6 2.5h3.2v11h-17z" {...s} />
          <Circle cx="12" cy="13.8" r="3.4" {...s} />
        </>
      );
    case 'phone':
      return (
        <>
          <Rect x="6.5" y="2.5" width="11" height="19" rx="2.2" {...s} />
          <Path d="M10.5 18.5h3" {...s} />
        </>
      );
    case 'warning-triangle':
      return (
        <>
          <Path d="M10.3 4.3L2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" {...s} />
          <Path d="M12 9.5v4.5M12 17.3h0" {...s} />
        </>
      );
    case 'flag':
      return <Path d="M5.5 21V3.5M5.5 4h11l-2.2 4.2 2.2 4.3h-11" {...s} />;
    case 'wrench':
      return (
        <Path
          d="M14.5 3.6a5 5 0 0 0-4.3 7.1L3.9 17a2 2 0 0 0 2.9 2.9l6.4-6.4a5 5 0 0 0 7.1-4.3l-2.9 2.1-2.7-.6-.6-2.7z"
          {...s}
        />
      );
    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...s} />;
    case 'minus':
      return <Path d="M5 12h14" {...s} />;
    case 'motorcycle':
      return (
        <>
          <Circle cx="5.5" cy="16" r="3.5" {...s} />
          <Circle cx="18.5" cy="16" r="3.5" {...s} />
          <Path
            d="M5.5 16l3.2-5.5h5.2l4.6 5.5M8.7 10.5l3.1 5.5h-6.3M13.9 10.5l-1.2-3.2h-2.4M15.5 7.3h2.4"
            {...s}
          />
        </>
      );
    case 'bluetooth':
      return <Path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9" {...s} />;
    case 'info':
      return (
        <>
          <Circle cx="12" cy="12" r="9" {...s} />
          <Path d="M12 11v5.5M12 7.8h0" {...s} />
        </>
      );
    case 'share':
      return (
        <>
          <Path d="M12 3.5v11M8 7.5l4-4 4 4" {...s} />
          <Path d="M5.5 12v8h13v-8" {...s} />
        </>
      );
    case 'reset':
      return <Path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" {...s} />;
  }
}

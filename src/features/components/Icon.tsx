import { View } from 'react-native';
import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';

import { colors } from '../../app/theme';

/**
 * Small stroke icon set drawn with react-native-svg (no icon font to load, identical on Android and web).
 * Icons are decorative: the control or text next to them always carries the accessible name, and no state is
 * conveyed by an icon alone.
 */
export type IconName =
  | 'back'
  | 'check'
  | 'close'
  | 'plus'
  | 'minus'
  | 'mic'
  | 'mic-off'
  | 'headset'
  | 'alert'
  | 'info'
  | 'chevron'
  | 'camera'
  | 'qr'
  | 'clock'
  | 'sliders'
  | 'pulse'
  | 'bluetooth'
  | 'bell'
  | 'wifi'
  | 'battery'
  | 'user'
  | 'play'
  | 'stop'
  | 'share'
  | 'reset';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 28, color = colors.text, strokeWidth = 2.2 }: IconProps) {
  const stroke = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  } as const;
  return (
    <View
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {renderShape(name, stroke, color)}
      </Svg>
    </View>
  );
}

type StrokeProps = {
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  fill: 'none';
};

function renderShape(name: IconName, s: StrokeProps, color: string) {
  switch (name) {
    case 'back':
      return <Path d="M19 12H6M12 5l-7 7 7 7" {...s} />;
    case 'check':
      return <Polyline points="4 12.5 9.5 18 20 6.5" {...s} />;
    case 'close':
      return <Path d="M6 6l12 12M18 6L6 18" {...s} />;
    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...s} />;
    case 'minus':
      return <Path d="M5 12h14" {...s} />;
    case 'mic':
      return (
        <>
          <Rect x="9" y="3" width="6" height="11" rx="3" {...s} />
          <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" {...s} />
        </>
      );
    case 'mic-off':
      return (
        <>
          <Rect x="9" y="3" width="6" height="11" rx="3" {...s} />
          <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" {...s} />
          <Path d="M3.5 3.5l17 17" {...s} strokeWidth={s.strokeWidth + 0.6} />
        </>
      );
    case 'headset':
      return (
        <>
          <Path d="M4 15v-3a8 8 0 0 1 16 0v3" {...s} />
          <Rect x="3" y="14" width="4.5" height="7" rx="2" {...s} />
          <Rect x="16.5" y="14" width="4.5" height="7" rx="2" {...s} />
        </>
      );
    case 'alert':
      return (
        <>
          <Path d="M12 3.5l9.5 16.5h-19z" {...s} />
          <Path d="M12 10v4.5" {...s} />
          <Circle cx="12" cy="17.2" r="0.7" fill={color} stroke={color} strokeWidth={0.6} />
        </>
      );
    case 'info':
      return (
        <>
          <Circle cx="12" cy="12" r="9" {...s} />
          <Path d="M12 11v6" {...s} />
          <Circle cx="12" cy="7.6" r="0.7" fill={color} stroke={color} strokeWidth={0.6} />
        </>
      );
    case 'chevron':
      return <Polyline points="9 5 16 12 9 19" {...s} />;
    case 'camera':
      return (
        <>
          <Path d="M3.5 8h3.5l1.5-2.5h7L17 8h3.5v11.5h-17z" {...s} />
          <Circle cx="12" cy="13.5" r="3.5" {...s} />
        </>
      );
    case 'qr':
      return (
        <>
          <Rect x="3.5" y="3.5" width="6" height="6" {...s} />
          <Rect x="14.5" y="3.5" width="6" height="6" {...s} />
          <Rect x="3.5" y="14.5" width="6" height="6" {...s} />
          <Path d="M14.5 14.5h3v3h-3zM20.5 14.5v6M14.5 20.5h3" {...s} />
        </>
      );
    case 'clock':
      return (
        <>
          <Circle cx="12" cy="12" r="9" {...s} />
          <Path d="M12 7v5.5l3.5 2" {...s} />
        </>
      );
    case 'sliders':
      return (
        <>
          <Path d="M4 6h8.5M17.5 6H20M4 12h2.5M11.5 12H20M4 18h9.5M18.5 18H20" {...s} />
          <Circle cx="15" cy="6" r="2.5" {...s} />
          <Circle cx="9" cy="12" r="2.5" {...s} />
          <Circle cx="16" cy="18" r="2.5" {...s} />
        </>
      );
    case 'pulse':
      return <Polyline points="3 12 7 12 9.5 5 14 19 16.5 12 21 12" {...s} />;
    case 'bluetooth':
      return <Path d="M7 7l10 10-5 4.5v-19L17 7 7 17" {...s} />;
    case 'bell':
      return (
        <>
          <Path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z" {...s} />
          <Path d="M10 21.5a2 2 0 0 0 4 0" {...s} />
        </>
      );
    case 'wifi':
      return (
        <>
          <Path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 16a5 5 0 0 1 6.6 0" {...s} />
          <Circle cx="12" cy="19.4" r="1" fill={color} stroke={color} strokeWidth={0.6} />
        </>
      );
    case 'battery':
      return (
        <>
          <Rect x="2.5" y="7" width="17" height="10" rx="2" {...s} />
          <Path d="M22 10.5v3" {...s} />
        </>
      );
    case 'user':
      return (
        <>
          <Circle cx="12" cy="8" r="4" {...s} />
          <Path d="M4.5 21a7.5 7.5 0 0 1 15 0" {...s} />
        </>
      );
    case 'play':
      return <Path d="M7 4.5v15l12-7.5z" {...s} fill={color} />;
    case 'stop':
      return <Rect x="6" y="6" width="12" height="12" rx="2" {...s} fill={color} />;
    case 'reset':
      return <Path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5V9h4.5" {...s} />;
    case 'share':
      return (
        <>
          <Path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" {...s} />
          <Path d="M5 12v8h14v-8" {...s} />
        </>
      );
  }
}

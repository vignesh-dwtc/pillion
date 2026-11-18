import { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { colors } from '../../../app/theme';

/**
 * Touring motorcycle seen from behind with rider and pillion, as engraved line art in a 60 x 80 box (origin top
 * left). Returns an SVG group: place it inside an <Svg> with a transform. Ivory lines, brass taillight.
 */
export function MotorcycleRear({
  stroke = colors.text,
  accent = colors.brass,
}: {
  stroke?: string;
  accent?: string;
}) {
  const s = {
    stroke,
    strokeWidth: 1.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  } as const;
  return (
    <G>
      {/* rider's helmet peeking over the pillion */}
      <Path d="M24.5 13.5a5.5 5.5 0 0 1 11 0" {...s} strokeOpacity={0.75} />
      {/* handlebar and mirrors */}
      <Path d="M8 30h44" {...s} strokeOpacity={0.7} />
      <Ellipse cx="6" cy="27" rx="3" ry="2.2" {...s} />
      <Ellipse cx="54" cy="27" rx="3" ry="2.2" {...s} />
      {/* pillion: helmet, shoulders, back */}
      <Circle cx="30" cy="20" r="6.5" {...s} fill={colors.bg} />
      <Path d="M24.5 19h11" {...s} strokeOpacity={0.6} />
      <Path d="M19 41c0-8 4.5-13 11-13s11 5 11 13" {...s} fill={colors.bg} />
      <Path d="M21 41l-1.5 8M39 41l1.5 8" {...s} />
      {/* saddle bags */}
      <Rect x="9" y="45" width="12" height="17" rx="3" {...s} />
      <Rect x="39" y="45" width="12" height="17" rx="3" {...s} />
      {/* rear fender, number plate and taillight */}
      <Path d="M20 49h20l-2 6H22z" {...s} />
      <Rect x="24.5" y="56.5" width="11" height="5" rx="1" {...s} strokeOpacity={0.6} />
      <Rect x="25" y="50" width="10" height="2.6" rx="1.3" fill={accent} />
      {/* rear tyre */}
      <Rect x="26" y="62" width="8" height="17" rx="4" {...s} />
      <Path d="M30 64v13" {...s} strokeOpacity={0.4} />
    </G>
  );
}

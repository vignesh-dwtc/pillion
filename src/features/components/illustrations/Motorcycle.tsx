import { Circle, G, Path, Rect } from 'react-native-svg';

import { colors } from '../../../app/theme';

/**
 * Motorcycle seen from behind with rider and pillion, as engraved line art in a 60 x 80 box (origin top left).
 * The rider (further away) shows a helmet peeking past the pillion, broad shoulders and arms out to the grips, with
 * mirrors on stalks; the pillion (nearest) is a helmet and back in front of the rider. Below: the seat and tail with
 * a single brass taillight, the number plate, one exhaust and a fat rear tyre. Returns an SVG group: place it inside
 * an <Svg> with a transform. `fill` is the occluding fill (the background the drawing sits on).
 */
export function MotorcycleRear({
  stroke = colors.text,
  accent = colors.brass,
  fill = colors.bg,
}: {
  stroke?: string;
  accent?: string;
  fill?: string;
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
      {/* mirrors on stalks and the handlebar */}
      <Path d="M8.5 36.5L6 29.5M51.5 36.5L54 29.5" {...s} />
      <Path d="M2.6 28.3a3.2 2.2 0 0 1 6.2-0.8M51.2 27.5a3.2 2.2 0 0 1 6.2 0.8" {...s} />
      <Path d="M7 37h46" {...s} strokeOpacity={0.7} />
      {/* rider: helmet peeking left of the pillion, shoulders, arms out to the grips */}
      <Circle cx="24.2" cy="15.2" r="6.2" {...s} fill={fill} strokeOpacity={0.85} />
      <Path d="M18.6 14.2h6" {...s} strokeOpacity={0.45} />
      <Path
        d="M8 37c1-5 3-8.5 7-10 3-1.2 6-1.8 9-1.8M52 37c-1-5-3-8.5-7-10-3-1.2-6-1.8-9-1.8"
        {...s}
        strokeOpacity={0.85}
      />
      {/* pillion: back, helmet with its seam, arms round the rider */}
      <Path
        d="M19.5 48.5c-0.6-8 1.2-14.5 5-16.2 1.8-0.8 3.6-1 5.5-1s3.7 0.2 5.5 1c3.8 1.7 5.6 8.2 5 16.2z"
        {...s}
        fill={fill}
      />
      <Circle cx="30.5" cy="22.5" r="7.2" {...s} fill={fill} />
      <Path d="M23.8 23.8c4.2 1.4 9.2 1.4 13.4 0" {...s} strokeOpacity={0.55} />
      <Path d="M30.3 34v12.5" {...s} strokeOpacity={0.3} />
      <Path d="M21.5 36c-2 3.5-2.2 7-1 10.5M39.5 36c2 3.5 2.2 7 1 10.5" {...s} strokeOpacity={0.55} />
      {/* boots on the pegs */}
      <Path d="M19 49l-3.5 7.5h-4M41 49l3.5 7.5h4" {...s} />
      {/* seat and tail section */}
      <Path d="M16.5 48.5h27l-3.2 6.5H19.7z" {...s} fill={fill} />
      {/* single exhaust on the right */}
      <Path d="M37 61.4l11-2.4a2.4 2.4 0 0 1 1 4.7l-11 2.4" {...s} fill={fill} />
      {/* number plate on the hugger */}
      <Rect x="24" y="56" width="12" height="4.6" rx="0.8" {...s} strokeOpacity={0.6} />
      {/* fat rear tyre with tread */}
      <Path d="M23 61.5h14v13a7 7 0 0 1-14 0z" {...s} fill={fill} />
      <Path d="M26.5 64v14M30 64v15M33.5 64v14" {...s} strokeOpacity={0.28} />
      {/* the taillight */}
      <Rect x="24.5" y="50.4" width="11" height="2.6" rx="1.3" fill={accent} />
    </G>
  );
}

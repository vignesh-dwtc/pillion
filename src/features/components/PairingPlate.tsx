import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { strings } from '../../app/strings';
import { colors, fonts } from '../../app/theme';
import { buildQrModel } from '../pair/qr';

import { polar } from './Dial/geometry';
import { chamferPath } from './Plate';

const W = 316;
const H = 372;
/** Screw slot angles: fixed and pseudo-random, so the plate looks hand-assembled but never changes. */
const SCREWS = [
  { x: 20, y: 20, angle: 23 },
  { x: W - 20, y: 20, angle: 117 },
  { x: 20, y: H - 20, angle: 64 },
  { x: W - 20, y: H - 20, angle: 152 },
] as const;

const FIELD = { x: 34, y: 30, w: W - 68, h: H - 60 };
const QR_SIZE = 200;

/**
 * The pairing plate: a chamfered brass frame with an inner engraved line and four slotted screws, an enamel field
 * engraved "PAIRING PLATE / ONE TIME · OFFLINE", the QR (uqr, ECC M, 4-module quiet zone, dark modules on enamel)
 * and the host's name in script under a brass rule. The secret is never rendered as text.
 */
export const PairingPlate = memo(function PairingPlate({
  value,
  hostName,
  width,
  accessibilityLabel,
  testID,
}: {
  value: string;
  hostName: string;
  width: number;
  accessibilityLabel: string;
  testID?: string;
}) {
  const model = useMemo(() => buildQrModel(value), [value]);
  const scale = Math.min(1.2, width / W);
  const qrX = (W - QR_SIZE) / 2;
  const qrY = FIELD.y + 50;
  const qrScale = QR_SIZE / model.viewBoxSize;
  return (
    <View
      testID={testID}
      role="img"
      aria-label={accessibilityLabel}
      style={{ width: W * scale, height: H * scale, alignSelf: 'center' }}
    >
      <Svg width={W * scale} height={H * scale} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="pp-brass" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.brassLight} />
            <Stop offset="0.55" stopColor={colors.brass} />
            <Stop offset="1" stopColor={colors.brassDeep} />
          </LinearGradient>
          <LinearGradient id="pp-screw" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.brassLight} />
            <Stop offset="1" stopColor={colors.brassShadow} />
          </LinearGradient>
        </Defs>
        <Path
          d={chamferPath(W, H, 22, 0.5)}
          fill="url(#pp-brass)"
          stroke={colors.brassDeep}
          strokeWidth={1}
        />
        <Path
          d={chamferPath(W, H, 22, 9)}
          fill="none"
          stroke={colors.onBrass}
          strokeOpacity={0.35}
          strokeWidth={0.8}
        />
        {SCREWS.map((screw) => {
          const a = polar(screw.x, screw.y, 4.4, screw.angle);
          const b = polar(screw.x, screw.y, 4.4, screw.angle + 180);
          return (
            <G key={`${screw.x}-${screw.y}`}>
              <Circle
                cx={screw.x}
                cy={screw.y}
                r={6.2}
                fill="url(#pp-screw)"
                stroke={colors.onBrass}
                strokeOpacity={0.55}
                strokeWidth={0.8}
              />
              <Line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={colors.onBrass}
                strokeWidth={1.3}
                strokeLinecap="round"
              />
            </G>
          );
        })}
        <Rect
          x={FIELD.x}
          y={FIELD.y}
          width={FIELD.w}
          height={FIELD.h}
          rx={3}
          fill={colors.enamel}
          stroke={colors.brassDeep}
          strokeWidth={1}
        />
        <SvgText
          x={W / 2}
          y={FIELD.y + 22}
          fill={colors.onBrass}
          fontFamily={fonts.legend}
          fontSize={12}
          letterSpacing={2.8}
          textAnchor="middle"
        >
          {strings.pairHost.plateTitle.toUpperCase()}
        </SvgText>
        <SvgText
          x={W / 2}
          y={FIELD.y + 38}
          fill={colors.enamelCaption}
          fontFamily={fonts.legend}
          fontSize={10}
          letterSpacing={2}
          textAnchor="middle"
        >
          {strings.pairHost.plateCaption.toUpperCase()}
        </SvgText>
        <G transform={`translate(${qrX} ${qrY}) scale(${qrScale})`}>
          <Rect x={0} y={0} width={model.viewBoxSize} height={model.viewBoxSize} fill={colors.qrLight} />
          <Path d={model.path} fill={colors.qrDark} />
        </G>
        <Line
          x1={W / 2 - 50}
          y1={qrY + QR_SIZE + 12}
          x2={W / 2 + 50}
          y2={qrY + QR_SIZE + 12}
          stroke={colors.brassDeep}
          strokeWidth={1}
        />
        <Path d={`M${W / 2} ${qrY + QR_SIZE + 9}l3 3-3 3-3-3z`} fill={colors.brassDeep} />
        <SvgText
          x={W / 2}
          y={qrY + QR_SIZE + 40}
          fill={colors.onBrass}
          fontFamily={fonts.script}
          fontSize={24}
          textAnchor="middle"
        >
          {hostName}
        </SvgText>
      </Svg>
    </View>
  );
});

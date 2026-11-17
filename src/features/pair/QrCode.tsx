import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '../../app/theme';

import { buildQrModel } from './qr';

/** Renders `value` as a QR code: one white SVG field with a 4-module quiet zone and one path for the dark modules. */
export function QrCode({
  value,
  size,
  accessibilityLabel,
  testID,
}: {
  value: string;
  size: number;
  accessibilityLabel: string;
  testID?: string;
}) {
  const model = useMemo(() => buildQrModel(value), [value]);
  return (
    <View testID={testID} role="img" aria-label={accessibilityLabel} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${model.viewBoxSize} ${model.viewBoxSize}`}>
        <Rect x={0} y={0} width={model.viewBoxSize} height={model.viewBoxSize} fill={colors.qrLight} />
        <Path d={model.path} fill={colors.qrDark} />
      </Svg>
    </View>
  );
}

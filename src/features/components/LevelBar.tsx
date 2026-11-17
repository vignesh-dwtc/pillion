import { View } from 'react-native';

import { borderWidth, colors, radius } from '../../app/theme';

/** Horizontal 0..1 meter. The number is always printed next to it by the caller, so the bar is a visual aid only. */
export function LevelBar({ level, testID }: { level: number | null; testID?: string }) {
  const clamped = level === null ? 0 : Math.min(1, Math.max(0, level));
  return (
    <View
      testID={testID}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      style={{
        height: 14,
        borderRadius: radius.pill,
        borderWidth: borderWidth.regular,
        borderColor: colors.border,
        backgroundColor: colors.bg,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          backgroundColor: colors.info,
        }}
      />
    </View>
  );
}

import { View } from 'react-native';

import { colors } from '../../app/theme';

/** Thin 0..1 meter on an engraved track. The number is always printed by the caller: the bar is a visual aid only. */
export function LevelBar({ level, testID }: { level: number | null; testID?: string }) {
  const clamped = level === null ? 0 : Math.min(1, Math.max(0, level));
  return (
    <View
      testID={testID}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      style={{ height: 6, backgroundColor: colors.face, borderWidth: 1, borderColor: colors.hairline }}
    >
      <View style={{ width: `${clamped * 100}%`, height: '100%', backgroundColor: colors.brass }} />
    </View>
  );
}

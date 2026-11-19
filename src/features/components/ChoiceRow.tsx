import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, hit, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { chamferPath } from './Plate';

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  /** Spoken label when the visible one is terse (for example "20" for "20 milliseconds"). */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Columns for a set of choices, so no chip sits alone on a row: short labels up to 4 share one row; otherwise rows
 * of 3 when the count divides by 3, else rows of 2.
 */
export function choiceColumns(labels: readonly string[]): number {
  const n = labels.length;
  if (n <= 3) return Math.max(1, n);
  const short = labels.every((label) => label.length <= 4);
  if (short && n <= 4) return n;
  return n % 3 === 0 ? 3 : 2;
}

/** A chamfered chip (corner cut 8): an SVG frame behind a 56 dp Pressable, like the plates. */
function Chip({
  selected,
  label,
  accessibilityLabel,
  testID,
  onPress,
}: {
  selected: boolean;
  label: string;
  accessibilityLabel: string;
  testID?: string;
  onPress: () => void;
}) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const onLayout = (event: LayoutChangeEvent) => {
    const w = Math.round(event.nativeEvent.layout.width);
    const h = Math.round(event.nativeEvent.layout.height);
    if (!box || box.w !== w || box.h !== h) setBox({ w, h });
  };
  const stroke = selected ? 1.5 : 1;
  return (
    <Pressable
      testID={testID}
      role="radio"
      aria-label={accessibilityLabel}
      aria-checked={selected}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onLayout={onLayout}
      style={{
        flex: 1,
        minHeight: hit.control,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
      }}
    >
      {box ? (
        <Svg width={box.w} height={box.h} style={{ position: 'absolute', left: 0, top: 0 }}>
          <Path
            d={chamferPath(box.w, box.h, CHIP_CHAMFER, stroke / 2)}
            fill={selected || pressed ? colors.surfaceRaised : colors.bg}
            stroke={selected ? colors.brass : colors.border}
            strokeWidth={stroke}
          />
        </Svg>
      ) : null}
      {selected ? <Icon name="check" size={16} color={colors.brass} strokeWidth={2} /> : null}
      <AppText variant="value" color={selected ? colors.brass : colors.text} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const CHIP_CHAMFER = 8;

/**
 * One-of-N selector of 56 dp chamfered chips in balanced rows. The selected chip has a brass frame, a raised fill
 * and a check mark: never colour alone.
 */
export function ChoiceRow<T extends string | number>({
  label,
  hint,
  choices,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint?: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}) {
  const columns = choiceColumns(choices.map((choice) => choice.label));
  const rows: Choice<T>[][] = [];
  for (let i = 0; i < choices.length; i += columns) rows.push(choices.slice(i, i + columns));
  return (
    <View testID={testID} role="radiogroup" aria-label={label} style={{ gap: spacing.sm }}>
      <AppText variant="bodyLarge">{label}</AppText>
      {hint ? (
        <AppText variant="caption" color={colors.textSubtle}>
          {hint}
        </AppText>
      ) : null}
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: spacing.sm }}>
          {row.map((choice) => (
            <Chip
              key={String(choice.value)}
              testID={choice.testID}
              selected={choice.value === value}
              label={choice.label}
              accessibilityLabel={choice.accessibilityLabel ?? choice.label}
              onPress={() => onChange(choice.value)}
            />
          ))}
          {Array.from({ length: columns - row.length }, (_, k) => (
            <View key={`pad${k}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

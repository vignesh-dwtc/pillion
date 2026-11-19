import { memo, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useAnimatedValue } from './motion/useAnimatedValue';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { chamfer as CHAMFER, colors, hit, spacing } from '../../app/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { duration } from './motion/tokens';
import { useReducedMotion } from './motion/useReducedMotion';

export type PlateVariant = 'brass' | 'mute' | 'muted' | 'oxblood' | 'outline';
export type PlateSize = 'control' | 'primary' | 'ride';

interface Palette {
  top: string;
  bottom: string;
  frame: string;
  frameWidth: number;
  label: string;
  sub: string;
  icon: string;
  engrave: string | null;
}

export const PLATE_PALETTE: Record<PlateVariant, Palette> = {
  brass: {
    top: colors.brassLight,
    bottom: colors.brassDeep,
    frame: colors.brassDeep,
    frameWidth: 1,
    label: colors.onBrass,
    sub: colors.onBrass,
    icon: colors.onBrass,
    engrave: colors.onBrass,
  },
  mute: {
    top: colors.muteFill,
    bottom: colors.muteFill,
    frame: colors.brass,
    frameWidth: 1.5,
    label: colors.brass,
    sub: colors.textMuted,
    icon: colors.brass,
    engrave: colors.brassShadow,
  },
  muted: {
    top: colors.muteFill,
    bottom: colors.muteFill,
    frame: colors.amber,
    frameWidth: 2,
    label: colors.amber,
    sub: colors.text,
    icon: colors.amber,
    engrave: colors.brassShadow,
  },
  oxblood: {
    top: colors.oxbloodTop,
    bottom: colors.oxbloodBottom,
    frame: colors.border,
    frameWidth: 1,
    label: colors.text,
    sub: colors.text,
    icon: colors.text,
    engrave: colors.text,
  },
  outline: {
    top: colors.bg,
    bottom: colors.bg,
    frame: colors.border,
    frameWidth: 1,
    label: colors.text,
    sub: colors.textMuted,
    icon: colors.brass,
    engrave: null,
  },
};

const HEIGHT: Record<PlateSize, number> = {
  control: hit.control,
  primary: hit.primary,
  ride: hit.rideHeight,
};

/** Chamfered polygon (corner cut `c`) inset by `inset`, as an SVG path. */
export function chamferPath(w: number, h: number, c: number, inset = 0): string {
  const i = inset;
  const k = Math.max(0, c - i * 0.6);
  return [
    `M${i + k} ${i}`,
    `H${w - i - k}`,
    `L${w - i} ${i + k}`,
    `V${h - i - k}`,
    `L${w - i - k} ${h - i}`,
    `H${i + k}`,
    `L${i} ${h - i - k}`,
    `V${i + k}`,
    'Z',
  ].join(' ');
}

/** Perimeter of `chamferPath` (for stroke draw-on). */
export function chamferPerimeter(w: number, h: number, c: number, inset = 0): number {
  const k = Math.max(0, c - inset * 0.6);
  const iw = w - 2 * inset;
  const ih = h - 2 * inset;
  return 2 * (iw - 2 * k) + 2 * (ih - 2 * k) + 4 * Math.SQRT2 * k;
}

const PlateBackground = memo(function PlateBackground({
  w,
  h,
  c,
  palette,
  id,
}: {
  w: number;
  h: number;
  c: number;
  palette: Palette;
  id: string;
}) {
  const fw = palette.frameWidth;
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }}>
      <Defs>
        <LinearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={palette.top} />
          <Stop offset="1" stopColor={palette.bottom} />
        </LinearGradient>
      </Defs>
      <Path
        d={chamferPath(w, h, c, fw / 2)}
        fill={`url(#${id}-fill)`}
        stroke={palette.frame}
        strokeWidth={fw}
      />
      {palette.engrave ? (
        <Path
          d={chamferPath(w, h, c, 4.5)}
          fill="none"
          stroke={palette.engrave}
          strokeOpacity={0.22}
          strokeWidth={0.8}
        />
      ) : null}
    </Svg>
  );
});

let plateIds = 0;

export interface PlateProps {
  label: string;
  /** Second line (sub-label) under the label. */
  sub?: string;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  testID?: string;
  variant?: PlateVariant;
  size?: PlateSize;
  icon?: IconName;
  /** Custom leading element instead of an icon (the Begin plate's key knob). */
  leading?: ReactNode;
  /** Trailing chevron (plates that lead to another screen). */
  chevron?: boolean;
  /** 'row': icon, text, chevron; 'stack': icon above the text, centred (ride plates). */
  layout?: 'row' | 'stack';
  disabled?: boolean;
  /** Spoken name (defaults to label + sub). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  role?: 'button' | 'switch';
  checked?: boolean;
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  /** Drawn over the plate, given its size (hold progress). */
  overlay?: (size: { w: number; h: number; c: number }) => ReactNode;
  style?: StyleProp<ViewStyle>;
  grow?: boolean;
}

/**
 * Chamfered plate button: an SVG polygon behind a Pressable (not a rounded rectangle). Press feedback: the plate
 * scales to 0.98 and darkens inside in 90 ms (reduced motion: no scale, only the inset).
 */
export function Plate({
  label,
  sub,
  onPress,
  onPressIn,
  onPressOut,
  testID,
  variant = 'brass',
  size = 'primary',
  icon,
  leading,
  chevron = false,
  layout = 'row',
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  role = 'button',
  checked,
  accessibilityActions,
  onAccessibilityAction,
  overlay,
  style,
  grow = false,
}: PlateProps) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const [id] = useState(() => `plate${++plateIds}`);
  const reduced = useReducedMotion();
  const scale = useAnimatedValue(1);
  const palette = PLATE_PALETTE[variant];
  const c = size === 'ride' ? CHAMFER.ride : CHAMFER.plate;
  const height = HEIGHT[size];
  const spoken = accessibilityLabel ?? (sub ? `${label}. ${sub}` : label);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height: h } = event.nativeEvent.layout;
    const w = Math.round(width);
    const hh = Math.round(h);
    if (!box || box.w !== w || box.h !== hh) setBox({ w, h: hh });
  };

  const animateTo = (value: number) => {
    if (reduced) return;
    Animated.timing(scale, { toValue: value, duration: duration.micro, useNativeDriver: true }).start();
  };

  const labelVariant = size === 'control' ? 'button' : 'plateLabel';
  const iconSize = size === 'ride' ? 30 : 24;
  const stack = layout === 'stack';
  const centered = !icon && !leading && !chevron;

  const inset = useMemo(
    () => (box ? chamferPath(box.w, box.h, c, palette.frameWidth) : null),
    [box, c, palette.frameWidth],
  );

  return (
    <Animated.View style={[{ transform: [{ scale }] }, grow ? { flex: 1 } : null, style]}>
      <Pressable
        testID={testID}
        role={role}
        aria-label={spoken}
        aria-disabled={disabled || undefined}
        aria-checked={role === 'switch' ? checked : undefined}
        accessibilityHint={accessibilityHint}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={onAccessibilityAction}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true);
          animateTo(0.98);
          onPressIn?.();
        }}
        onPressOut={() => {
          setPressed(false);
          animateTo(1);
          onPressOut?.();
        }}
        onLayout={onLayout}
        style={{
          minHeight: height,
          paddingHorizontal: stack ? spacing.sm : spacing.lg,
          paddingVertical: stack ? spacing.sm : spacing.md,
          flexDirection: stack ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: stack || (!icon && !leading && !chevron) ? 'center' : 'flex-start',
          gap: stack ? spacing.xs : spacing.md,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        {box ? <PlateBackground w={box.w} h={box.h} c={c} palette={palette} id={id} /> : null}
        {box && pressed && inset ? (
          <Svg width={box.w} height={box.h} style={{ position: 'absolute', left: 0, top: 0 }}>
            <Path d={inset} fill={colors.bg} fillOpacity={0.16} />
          </Svg>
        ) : null}
        {box && overlay ? overlay({ w: box.w, h: box.h, c }) : null}
        {leading ?? (icon ? <Icon name={icon} size={iconSize} color={palette.icon} /> : null)}
        {label || sub ? (
          <View
            style={{
              flex: stack ? undefined : 1,
              alignItems: stack || centered ? 'center' : 'flex-start',
              gap: 2,
            }}
          >
            <AppText
              variant={labelVariant}
              maxFontSizeMultiplier={size === 'ride' ? 1.15 : undefined}
              color={palette.label}
              align={stack ? 'center' : 'left'}
            >
              {label}
            </AppText>
            {sub ? (
              <AppText
                variant="caption"
                maxFontSizeMultiplier={size === 'ride' ? 1.1 : undefined}
                color={palette.sub}
                align={stack ? 'center' : 'left'}
                numberOfLines={2}
              >
                {sub}
              </AppText>
            ) : null}
          </View>
        ) : null}
        {chevron ? <Icon name="chevron" size={20} color={palette.icon} /> : null}
      </Pressable>
    </Animated.View>
  );
}

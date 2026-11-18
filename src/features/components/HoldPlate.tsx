import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { useAnimatedValue } from './motion/useAnimatedValue';
import Svg, { Path } from 'react-native-svg';

import { strings } from '../../app/strings';
import { colors } from '../../app/theme';

import { duration } from './motion/tokens';
import { haptic } from './motion/haptics';
import { useReducedMotion } from './motion/useReducedMotion';
import { Plate, chamferPath, chamferPerimeter, type PlateProps } from './Plate';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * A plate that needs a 1.0 s press (End ride). A brassLight stroke traces the plate outline while held, with a haptic
 * tick at the start and at completion; releasing early reverses it in 200 ms. Reduced motion: no stroke, the
 * sub-label counts down in steps. Screen readers: the 'activate' action asks for a confirmation (activate again)
 * and then completes immediately, without the hold.
 */
export function HoldPlate({
  onComplete,
  label,
  sub,
  testID,
  accessibilityLabel,
  ...rest
}: Omit<PlateProps, 'onPress' | 'onPressIn' | 'onPressOut' | 'overlay' | 'accessibilityActions'> & {
  onComplete: () => void;
}) {
  const reduced = useReducedMotion();
  const progress = useAnimatedValue(0);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (!reduced) return;
    const id = progress.addListener(({ value }) => {
      setRemaining(value <= 0 ? null : Math.max(0, Math.ceil((1 - value) * 4) / 4));
    });
    return () => progress.removeListener(id);
  }, [progress, reduced]);

  const complete = () => {
    if (done.current) return;
    done.current = true;
    haptic.medium();
    onComplete();
  };

  const start = () => {
    done.current = false;
    haptic.tick();
    running.current?.stop();
    running.current = Animated.timing(progress, {
      toValue: 1,
      duration: duration.hold,
      useNativeDriver: false,
    });
    running.current.start(({ finished }) => {
      if (finished) complete();
    });
  };

  const release = () => {
    if (done.current) return;
    running.current?.stop();
    running.current = Animated.timing(progress, {
      toValue: 0,
      duration: duration.holdRelease,
      useNativeDriver: false,
    });
    running.current.start();
  };

  const subLabel = armed
    ? strings.ride.endConfirm
    : remaining !== null
      ? strings.ride.endHolding(remaining)
      : sub;

  return (
    <Plate
      {...rest}
      label={label}
      sub={subLabel}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={strings.ride.endA11yHint}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName !== 'activate') return;
        if (!armed) {
          setArmed(true);
          AccessibilityInfo.announceForAccessibility(strings.ride.endConfirm);
          return;
        }
        setArmed(false);
        complete();
      }}
      onPressIn={start}
      onPressOut={release}
      overlay={({ w, h, c }) => {
        if (reduced) return null;
        const inset = 2.5;
        const len = chamferPerimeter(w, h, c, inset);
        const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [len, 0] });
        return (
          <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
            <AnimatedPath
              d={chamferPath(w, h, c, inset)}
              fill="none"
              stroke={colors.brassLight}
              strokeWidth={3}
              strokeLinejoin="round"
              strokeDasharray={[len, len]}
              strokeDashoffset={dashOffset}
            />
          </Svg>
        );
      }}
    />
  );
}

import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

const TRACK_HEIGHT = 60;
const KNOB = 52;
const PADDING = 4;

export default function SlideToConfirm({
  label = 'Trượt để Xác nhận',
  lockedLabel = 'Đã khoá',
  disabled = false,
  onConfirm,
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [done, setDone] = useState(false);
  const x = useRef(new Animated.Value(0)).current;
  const maxX = Math.max(trackWidth - KNOB - PADDING * 2, 1);

  const stateRef = useRef({ maxX: 1, disabled, done });
  stateRef.current = { maxX, disabled, done };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !stateRef.current.disabled && !stateRef.current.done,
        onMoveShouldSetPanResponder: () => !stateRef.current.disabled && !stateRef.current.done,
        onPanResponderMove: (_evt, gesture) => {
          const next = Math.min(Math.max(gesture.dx, 0), stateRef.current.maxX);
          x.setValue(next);
        },
        onPanResponderRelease: (_evt, gesture) => {
          const limit = stateRef.current.maxX;
          if (gesture.dx >= limit * 0.9) {
            Animated.timing(x, { toValue: limit, duration: 100, useNativeDriver: false }).start(
              () => {
                setDone(true);
                if (onConfirm) onConfirm();
              }
            );
          } else {
            Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 4 }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 4 }).start();
        },
      }),
    [onConfirm, x]
  );

  const fillWidth = x.interpolate({
    inputRange: [0, maxX],
    outputRange: [KNOB + PADDING * 2, trackWidth || KNOB],
    extrapolate: 'clamp',
  });

  const textOpacity = x.interpolate({
    inputRange: [0, maxX * 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={[styles.track, disabled && styles.trackDisabled]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[styles.fill, { width: fillWidth }, done && styles.fillDone]}
        pointerEvents="none"
      />
      <Animated.Text
        style={[styles.label, { opacity: textOpacity }, disabled && styles.labelDisabled]}
        pointerEvents="none"
      >
        {done ? 'Đã xác nhận' : disabled ? lockedLabel : label}
      </Animated.Text>
      <Animated.View
        style={[styles.knob, done && styles.knobDone, { transform: [{ translateX: x }] }]}
        {...responder.panHandlers}
      >
        <Text style={styles.knobText}>{done ? '✓' : '›'}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: 16,
    backgroundColor: '#0B0D11',
    borderWidth: 1,
    borderColor: '#2A2F3A',
    justifyContent: 'center',
    padding: PADDING,
    overflow: 'hidden',
  },
  trackDisabled: { opacity: 0.45 },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(34,197,94,0.16)',
  },
  fillDone: { backgroundColor: 'rgba(34,197,94,0.32)' },
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 15,
    fontWeight: '600',
  },
  labelDisabled: { color: '#6B7280' },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: 16,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobDone: { backgroundColor: '#16A34A' },
  knobText: { color: '#08130C', fontSize: 24, fontWeight: '800' },
});

import { StyleSheet, Text, View } from 'react-native';

const TONES = { ok: '#22C55E', warn: '#F59E0B', bad: '#EF4444' };

export default function StatusLight({ ok = false, tone, text = '' }) {
  const color = TONES[tone] || (ok ? TONES.ok : TONES.bad);
  return (
    <View style={styles.row}>
      <View style={[styles.glow, { backgroundColor: color, shadowColor: color }]}>
        <View style={[styles.core, { backgroundColor: color }]} />
      </View>
      {text ? <Text style={[styles.text, { color }]}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  glow: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.35,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  core: { width: 10, height: 10, borderRadius: 5 },
  text: { flex: 1, fontSize: 13, fontWeight: '600' },
});

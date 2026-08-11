import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export default function KeyRow({ label, value, hidden = false, right = null }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(String(value));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.actions}>
          {right}
          <Pressable onPress={copy} hitSlop={8} style={styles.copyBtn}>
            <Text style={styles.copyText}>{copied ? 'Đã chép' : 'Chép'}</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.value} selectable={!hidden}>
        {hidden ? '•'.repeat(32) : String(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#0B0D11',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#22262F',
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(34,197,94,0.14)',
  },
  copyText: { color: '#22C55E', fontSize: 12, fontWeight: '700' },
  value: { color: '#E5E7EB', fontFamily: MONO, fontSize: 12, lineHeight: 18 },
});

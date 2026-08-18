import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MONO } from '../components/KeyRow';
import SlideToConfirm from '../components/SlideToConfirm';
import { coinsOf } from '../blockchain/consensus';
import { makeNonce, signPayload } from '../crypto/sign';
import { getNode, useNodeState } from '../node/runtime';

export default function TransferScreen({ session, onClose }) {
  const state = useNodeState();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('');

  const confirm = async () => {
    setError('');
    const node = getNode();
    if (!node) return setError('Node chưa khởi động.');

    const receiver = to.trim().toLowerCase();
    const value = Number(amount);
    const balance = coinsOf(node.store.state, session.publicKey);

    if (!/^[0-9a-f]{66}$/.test(receiver)) {
      return setError('Public key người nhận phải đúng 66 ký tự hex.');
    }
    if (receiver === session.publicKey) return setError('Không thể tự gửi cho chính mình.');
    if (!Number.isFinite(value) || value <= 0) return setError('Số coin phải lớn hơn 0.');
    if (value > balance) return setError('Số dư đã xác nhận không đủ (còn ' + balance + ' coin).');

    try {
      setPhase('Đang ký bằng khóa riêng...');
      const tx = {
        type: 'TRANSFER',
        from: session.publicKey,
        to: receiver,
        amount: value,
        timestamp: Date.now(),
        nonce: makeNonce(),
      };
      tx.signature = await signPayload(tx, session.privateKey);

      setPhase('Đang phát ra mạng...');
      // Ký xong chỉ là vào mempool. Coin chỉ thật sự chuyển khi có node đào được block chứa nó.
      const res = await node.submitTransaction(tx);
      setPhase('');

      if (!res.ok) return setError('Mạng từ chối giao dịch: ' + res.reason);

      Alert.alert(
        'Đã phát giao dịch ra mạng',
        'Đã gửi ' +
          value +
          ' coin.\nChữ ký: ' +
          tx.signature.slice(0, 16) +
          '…' +
          tx.signature.slice(-8) +
          '\n\nGiao dịch đang chờ xác nhận trong mempool. Số dư chỉ đổi khi nó nằm trong một block.',
        [{ text: 'Xong', onPress: onClose }]
      );
    } catch (e) {
      setPhase('');
      setError('Lỗi: ' + String(e.message || e));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.close}>Đóng</Text>
        </Pressable>
        <Text style={styles.title}>Chuyển coin</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>Sent to: (public key người nhận, 66 hex)</Text>
          <TextInput
            style={[styles.input, styles.mono]}
            value={to}
            onChangeText={setTo}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder="02…"
            placeholderTextColor="#4B5563"
          />

          <Text style={styles.label}>Số coin</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor="#4B5563"
          />

          <Text style={styles.hint}>
            Số dư đã xác nhận: {state.confirmed.coins} coin · chain đang cao {state.height} block
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <SlideToConfirm label="Trượt để Xác nhận" onConfirm={confirm} />
      </ScrollView>

      {phase ? (
        <View style={styles.overlay}>
          <ActivityIndicator color="#22C55E" size="large" />
          <Text style={styles.overlayText}>{phase}</Text>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F1115' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
  },
  close: { color: '#22C55E', fontSize: 13, fontWeight: '700', width: 40 },
  title: { color: '#E5E7EB', fontSize: 18, fontWeight: '800' },
  scroll: { padding: 20, gap: 20 },
  card: { backgroundColor: '#1A1D24', borderRadius: 16, padding: 16, gap: 8 },
  label: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', marginTop: 6 },
  input: {
    backgroundColor: '#0B0D11',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#22262F',
    color: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  mono: { fontFamily: MONO, fontSize: 12, minHeight: 62 },
  hint: { color: '#6B7280', fontSize: 11, lineHeight: 16 },
  error: { color: '#EF4444', fontSize: 13, fontWeight: '600', marginTop: 4 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,17,21,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  overlayText: { color: '#E5E7EB', fontSize: 16, fontWeight: '700' },
});

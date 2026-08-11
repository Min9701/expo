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
import { makeNonce, signPayload, txid } from '../crypto/sign';
import { getNode, useNodeState } from '../node/runtime';

export default function BuyScreen({ session, onClose }) {
  const state = useNodeState();
  const [seller, setSeller] = useState('');
  const [nftCount, setNftCount] = useState('');
  const [coinAmount, setCoinAmount] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('');

  const confirm = async () => {
    setError('');
    const node = getNode();
    if (!node) return setError('Node chưa khởi động.');

    const sellerKey = seller.trim().toLowerCase();
    const nfts = Number(nftCount);
    const coins = Number(coinAmount);
    const balance = coinsOf(node.store.state, session.publicKey);

    if (!/^[0-9a-f]{66}$/.test(sellerKey)) {
      return setError('Public key bên bán phải đúng 66 ký tự hex.');
    }
    if (sellerKey === session.publicKey) return setError('Không thể tự mua của chính mình.');
    if (!Number.isInteger(nfts) || nfts <= 0) return setError('Số NFT phải là số nguyên lớn hơn 0.');
    if (!Number.isFinite(coins) || coins <= 0) return setError('Số coin phải lớn hơn 0.');
    if (coins > balance) return setError('Số dư đã xác nhận không đủ (còn ' + balance + ' coin).');

    try {
      setPhase('Đang ký bằng khóa riêng...');
      const tx = {
        type: 'TRADE',
        buyer: session.publicKey,
        seller: sellerKey,
        nftCount: nfts,
        coinAmount: coins,
        timestamp: Date.now(),
        nonce: makeNonce(),
      };
      const buyerSignature = await signPayload(tx, session.privateKey);

      // id chính là txid của giao dịch sau này, nên khi block chứa nó về tới đây
      // node tự khớp được lệnh mà không cần nói thêm với nhau.
      setPhase('Đang phát lệnh ra mạng...');
      await node.submitOrder({
        id: txid(tx),
        ...tx,
        buyerSignature,
        status: 'AWAITING_SELLER',
      });
      setPhase('');

      Alert.alert(
        'Đã gửi lệnh mua ra mạng',
        'Chữ ký của bạn: ' +
          buyerSignature.slice(0, 16) +
          '…' +
          buyerSignature.slice(-8) +
          '\n\nBên bán sẽ thấy lệnh ngay. Họ phải tự xác minh chữ ký này rồi ký chữ ký thứ hai.',
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
        <Text style={styles.title}>Mua NFT</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>Sent to: (public key bên bán, 66 hex)</Text>
          <TextInput
            style={[styles.input, styles.mono]}
            value={seller}
            onChangeText={setSeller}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder="02…"
            placeholderTextColor="#4B5563"
          />

          <Text style={styles.label}>Số NFT muốn mua</Text>
          <TextInput
            style={styles.input}
            value={nftCount}
            onChangeText={setNftCount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor="#4B5563"
          />

          <Text style={styles.label}>Số coin trả</Text>
          <TextInput
            style={styles.input}
            value={coinAmount}
            onChangeText={setCoinAmount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor="#4B5563"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.hint}>
            Số dư đã xác nhận: {state.confirmed.coins} coin.{'\n'}
            Lệnh cần hai chữ ký. Đủ hai chữ ký thì giao dịch mới vào mempool, và chỉ có hiệu lực
            khi có node đào được block chứa nó.
          </Text>
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
  close: { color: '#22C55E', fontSize: 15, fontWeight: '700', width: 40 },
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

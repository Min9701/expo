import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import KeyRow, { MONO } from '../components/KeyRow';
import SlideToConfirm from '../components/SlideToConfirm';
import StatusLight from '../components/StatusLight';
import { shortHash } from '../blockchain/Block';
import { nftsOf } from '../blockchain/consensus';
import { RELAY_URL } from '../config';
import { signPayload, verifySignature } from '../crypto/sign';
import { clearOrderAlert, getNode, startMining, stopMining, useNodeState } from '../node/runtime';
import BuyScreen from './BuyScreen';
import TransferScreen from './TransferScreen';

const CONNECTION_TEXT = {
  open: 'Đã nối relay — đang trong mạng',
  connecting: 'Đang kết nối relay…',
  reconnecting: 'Mất relay, đang thử lại…',
  closed: 'Không có kết nối relay',
};

function connectionTone(status) {
  if (status === 'open') return 'ok';
  if (status === 'closed') return 'bad';
  return 'warn';
}

function logColor(level) {
  if (level === 'success') return '#22C55E';
  if (level === 'error') return '#EF4444';
  if (level === 'warn') return '#F59E0B';
  return '#9CA3AF';
}

// Lệnh mua chờ chính ví này ký chữ ký thứ hai.
function SellerOrderCard({ order, session, node }) {
  const [pasted, setPasted] = useState('');
  const [verified, setVerified] = useState(false);
  const [message, setMessage] = useState('Chưa xác minh chữ ký bên mua');
  const [busy, setBusy] = useState(false);

  // Xác minh TẠI MÁY NÀY bằng secp256k1.verify — không hỏi relay, không hỏi ai cả.
  const runVerify = async () => {
    const key = pasted.trim().toLowerCase();
    if (!/^[0-9a-f]{66}$/.test(key)) {
      setVerified(false);
      return setMessage('Public key phải đúng 66 ký tự hex');
    }
    const signatureOk = await verifySignature(order, order.buyerSignature, key);
    if (!signatureOk) {
      setVerified(false);
      return setMessage('Xác minh thất bại — chữ ký không khớp khoá này');
    }
    if (key !== order.buyer) {
      setVerified(false);
      return setMessage('Chữ ký hợp lệ nhưng không phải của bên mua ghi trong lệnh');
    }
    setVerified(true);
    setMessage('Đã xác minh: đúng là ví này đã ký lệnh mua');
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const myNfts = nftsOf(node.store.state, session.publicKey);
      if (myNfts < order.nftCount) {
        return Alert.alert('Không đủ NFT', 'Bạn chỉ có ' + myNfts + ' NFT đã xác nhận.');
      }

      const tx = {
        type: 'TRADE',
        buyer: order.buyer,
        seller: order.seller,
        nftCount: order.nftCount,
        coinAmount: order.coinAmount,
        timestamp: order.timestamp,
        nonce: order.nonce,
        buyerSignature: order.buyerSignature,
      };
      tx.sellerSignature = await signPayload(tx, session.privateKey);

      const res = await node.submitTransaction(tx);
      if (!res.ok) return Alert.alert('Mạng từ chối giao dịch', res.reason);

      await node.closeOrder(order.id, 'FILLED');
      Alert.alert(
        'Đã ký và phát ra mạng',
        'Giao dịch đã đủ 2 chữ ký và đang nằm trong mempool.\n\n' +
          'Số dư và NFT chỉ đổi khi có node đào được block chứa nó.'
      );
    } catch (e) {
      Alert.alert('Lỗi', String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.orderCard}>
      <View style={styles.orderHead}>
        <Text style={styles.orderTitle}>
          Ví {shortHash(order.buyer, 8, 4)} muốn mua {order.nftCount} NFT với {order.coinAmount} coin
        </Text>
        <Pressable
          onPress={() => node.closeOrder(order.id, 'REJECTED')}
          hitSlop={10}
          style={styles.rejectBtn}
        >
          <Text style={styles.rejectText}>✕</Text>
        </Pressable>
      </View>

      <StatusLight ok={verified} text={message} />

      <Text style={styles.label}>Verify: (dán public key bên mua)</Text>
      <TextInput
        style={[styles.input, styles.mono]}
        value={pasted}
        onChangeText={(t) => {
          setPasted(t);
          setVerified(false);
          setMessage('Chưa xác minh chữ ký bên mua');
        }}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        placeholder="02…"
        placeholderTextColor="#4B5563"
      />
      <Pressable style={styles.verifyBtn} onPress={runVerify}>
        <Text style={styles.verifyText}>Xác minh</Text>
      </Pressable>

      <SlideToConfirm
        label="Trượt để Xác nhận bán"
        lockedLabel="Cần xác minh chữ ký trước"
        disabled={!verified || busy}
        onConfirm={confirm}
      />
    </View>
  );
}

export default function WalletScreen({ session, onLogout }) {
  const state = useNodeState();
  const [showPrivate, setShowPrivate] = useState(false);
  const [modal, setModal] = useState(null);
  const node = getNode();

  const { confirmed, pending } = state;
  const hasPendingChange = pending.coins !== confirmed.coins || pending.nfts !== confirmed.nfts;

  const sellerOrders = state.orders.filter(
    (o) => o.seller === session.publicKey && o.status === 'AWAITING_SELLER'
  );
  const buyerOrders = state.orders.filter((o) => o.buyer === session.publicKey);

  const alreadyFaucet = node ? node.store.faucets.has(session.publicKey) : false;
  const faucetPending = node
    ? node.mempool.list().some((tx) => tx.type === 'FAUCET' && tx.to === session.publicKey)
    : false;

  const askFaucet = async () => {
    const res = await node.requestFaucet();
    Alert.alert(
      res.ok ? 'Đã phát yêu cầu FAUCET' : 'Không xin được FAUCET',
      res.ok
        ? 'Giao dịch FAUCET đang ở mempool. Nó chỉ có hiệu lực khi có node đào được block chứa nó.'
        : res.reason
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.hello}>{session.username}</Text>
            <Text style={styles.nodeLine}>Full node trên máy này</Text>
          </View>
          <Pressable onPress={onLogout} hitSlop={10}>
            <Text style={styles.logout}>Đăng xuất</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <StatusLight
            tone={connectionTone(state.connection)}
            text={CONNECTION_TEXT[state.connection] || state.connection}
          />
          {state.connection !== 'open' ? (
            <Text style={styles.muted}>
              {state.connectionDetail || 'Relay: ' + RELAY_URL}
              {'\n'}Sửa RELAY_URL trong src/config.js nếu IP laptop đã đổi.
            </Text>
          ) : null}

          <View style={styles.statGrid}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{state.height}</Text>
              <Text style={styles.statLabel}>chiều cao chain</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{state.mempoolSize}</Text>
              <Text style={styles.statLabel}>tx chờ trong mempool</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: state.mining ? '#22C55E' : '#6B7280' }]}>
                {state.mining ? 'ĐANG ĐÀO' : 'nghỉ'}
              </Text>
              <Text style={styles.statLabel}>trạng thái đào</Text>
            </View>
          </View>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Số dư đã xác nhận</Text>
          <Text style={styles.balance}>{confirmed.coins} coin</Text>
          <Text style={styles.nftCount}>{confirmed.nfts} NFT đang sở hữu</Text>
          {hasPendingChange ? (
            <Text style={styles.pendingLine}>
              Đang chờ xác nhận → {pending.coins} coin, {pending.nfts} NFT
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Đào block</Text>
          <Pressable
            style={[styles.mineBtn, state.mining && styles.mineBtnActive]}
            onPress={() => (state.mining ? stopMining() : startMining())}
          >
            <Text style={[styles.mineText, state.mining && styles.mineTextActive]}>
              {state.mining ? 'Dừng đào' : 'Bắt đầu đào'}
            </Text>
          </Pressable>
          <Text style={styles.muted}>
            hashrate ≈ {state.miningStats.hashrate} hash/s · nonce {state.miningStats.nonce} · bạn đã đào được{' '}
            {state.miningStats.minedByMe} block
          </Text>
          <Text style={styles.muted}>
            Vòng đào chạy theo từng lượt nhỏ rồi nhả luồng, nên app vẫn chuyển tab và bấm được bình thường.
          </Text>
        </View>

        {!alreadyFaucet ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Tài sản ban đầu (FAUCET)</Text>
            <Text style={styles.muted}>
              {faucetPending
                ? 'Yêu cầu FAUCET đang chờ được đào vào block.'
                : 'Ví này chưa nhận FAUCET. Mỗi public key chỉ được nhận đúng MỘT lần trong toàn bộ chain — đây là luật đồng thuận, mọi node đều tự kiểm tra.'}
            </Text>
            {!faucetPending ? (
              <Pressable style={styles.verifyBtn} onPress={askFaucet}>
                <Text style={styles.verifyText}>Xin FAUCET</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable style={styles.actionBtn} onPress={() => setModal('transfer')}>
            <Text style={styles.actionText}>Chuyển coin</Text>
          </Pressable>
          {/* <Pressable style={styles.actionBtn} onPress={() => setModal('buy')}>
            <Text style={styles.actionText}>Mua NFT</Text>
          </Pressable> */}
        </View>

        <KeyRow label="ĐỊA CHỈ VÍ" value={session.address} />
        <KeyRow label="PUBLIC KEY" value={session.publicKey} />
        {/* <KeyRow
          label="PRIVATE KEY"
          value={session.privateKey}
          hidden={!showPrivate}
          right={
            <Pressable onPress={() => setShowPrivate((v) => !v)} hitSlop={8}>
              <Text style={styles.eye}>{showPrivate ? '🙈 Ẩn' : '👁 Hiện'}</Text>
            </Pressable>
          }
        /> */}

        {sellerOrders.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lệnh mua đang chờ bạn xác nhận</Text>
            {sellerOrders.map((order) => (
              <SellerOrderCard key={order.id} order={order} session={session} node={node} />
            ))}
          </View>
        ) : null}

        {buyerOrders.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lệnh mua của bạn</Text>
            {buyerOrders.map((order) => (
              <View key={order.id} style={styles.card}>
                <Text style={styles.cardText}>
                  {order.nftCount} NFT — {order.coinAmount} coin → {shortHash(order.seller, 10, 6)}
                </Text>
                <StatusLight
                  tone={order.status === 'FILLED' ? 'ok' : order.status === 'REJECTED' ? 'bad' : 'warn'}
                  text={
                    order.status === 'FILLED'
                      ? 'Bên bán đã ký, giao dịch đã vào mạng'
                      : order.status === 'REJECTED'
                        ? 'Bên bán đã từ chối lệnh này'
                        : 'Chờ bên bán xác nhận'
                  }
                />
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nhật ký node</Text>
          <View style={styles.card}>
            {state.logs.length === 0 ? (
              <Text style={styles.muted}>Chưa có gì.</Text>
            ) : (
              state.logs.map((entry, i) => (
                <Text key={i} style={[styles.logLine, { color: logColor(entry.level) }]}>
                  {entry.message}
                </Text>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* Lệnh mua mới hiện ngay, không cần refresh */}
      <Modal visible={!!state.orderAlert} transparent animationType="fade">
        <View style={styles.alertWrap}>
          <View style={styles.alertBox}>
            <Text style={styles.alertTitle}>Có lệnh mua mới</Text>
            {state.orderAlert ? (
              <Text style={styles.alertText}>
                {shortHash(state.orderAlert.order.buyer, 8, 4)} muốn mua{' '}
                {state.orderAlert.order.nftCount} NFT với {state.orderAlert.order.coinAmount} coin.
                {state.orderAlert.order.seller === session.publicKey
                  ? '\n\nLệnh này chờ bạn xác minh và ký.'
                  : '\n\nLệnh này dành cho ví khác.'}
              </Text>
            ) : null}
            <Pressable style={styles.alertBtn} onPress={clearOrderAlert}>
              <Text style={styles.alertBtnText}>Đã hiểu</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={modal === 'transfer'} animationType="slide" onRequestClose={() => setModal(null)}>
        <TransferScreen session={session} onClose={() => setModal(null)} />
      </Modal>
      <Modal visible={modal === 'buy'} animationType="slide" onRequestClose={() => setModal(null)}>
        <BuyScreen session={session} onClose={() => setModal(null)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F1115' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40, paddingTop: 56 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hello: { color: '#E5E7EB', fontSize: 20, fontWeight: '800' },
  nodeLine: { color: '#6B7280', fontSize: 12 },
  logout: { color: '#EF4444', fontSize: 14, fontWeight: '700' },
  balanceCard: { backgroundColor: '#1A1D24', borderRadius: 16, padding: 20, gap: 4 },
  balanceLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '700' },
  balance: { color: '#22C55E', fontSize: 36, fontWeight: '800' },
  nftCount: { color: '#9CA3AF', fontSize: 14 },
  pendingLine: { color: '#F59E0B', fontSize: 13, fontWeight: '700', marginTop: 4 },
  statGrid: { flexDirection: 'row', gap: 12, marginTop: 4 },
  stat: { flex: 1, gap: 2 },
  statValue: { color: '#E5E7EB', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#6B7280', fontSize: 11 },
  actions: { flexDirection: 'row', gap: 12 },
  actionBtn: {
    flex: 1,
    backgroundColor: '#22C55E',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionText: { color: '#08130C', fontWeight: '800', fontSize: 15 },
  mineBtn: {
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  mineBtnActive: { backgroundColor: 'rgba(239,68,68,0.16)' },
  mineText: { color: '#22C55E', fontWeight: '800', fontSize: 15 },
  mineTextActive: { color: '#EF4444' },
  section: { gap: 8, marginTop: 8 },
  sectionTitle: { color: '#9CA3AF', fontSize: 13, fontWeight: '700' },
  card: { backgroundColor: '#1A1D24', borderRadius: 16, padding: 16, gap: 8 },
  cardText: { color: '#E5E7EB', fontSize: 14, fontWeight: '600' },
  muted: { color: '#6B7280', fontSize: 12, lineHeight: 18 },
  logLine: { fontSize: 12, lineHeight: 18 },
  eye: { color: '#9CA3AF', fontSize: 12, fontWeight: '700' },
  orderCard: { backgroundColor: '#1A1D24', borderRadius: 16, padding: 16, gap: 10 },
  orderHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  orderTitle: { color: '#E5E7EB', fontSize: 14, fontWeight: '700', flex: 1 },
  rejectBtn: {
    width: 28,
    height: 28,
    borderRadius: 16,
    backgroundColor: 'rgba(239,68,68,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: { color: '#EF4444', fontSize: 15, fontWeight: '800' },
  label: { color: '#9CA3AF', fontSize: 12, fontWeight: '700' },
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
  verifyBtn: {
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  verifyText: { color: '#22C55E', fontWeight: '800', fontSize: 14 },
  alertWrap: {
    flex: 1,
    backgroundColor: 'rgba(15,17,21,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  alertBox: { backgroundColor: '#1A1D24', borderRadius: 16, padding: 20, gap: 12, width: '100%' },
  alertTitle: { color: '#F59E0B', fontSize: 18, fontWeight: '800' },
  alertText: { color: '#E5E7EB', fontSize: 14, lineHeight: 20 },
  alertBtn: {
    backgroundColor: '#22C55E',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  alertBtnText: { color: '#08130C', fontWeight: '800', fontSize: 15 },
});

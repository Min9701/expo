import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MONO } from '../components/KeyRow';
import { shortHash } from '../blockchain/Block';
import { validateChain } from '../blockchain/consensus';
import { isGenesisBlock } from '../blockchain/genesis';
import { CONFIRMATIONS_SAFE } from '../config';
import { getNode, useNodeState } from '../node/runtime';

function TxRow({ tx }) {
  if (tx.type === 'COINBASE') {
    return (
      <View style={styles.tx}>
        <Text style={styles.txType}>COINBASE (thưởng đào)</Text>
        <Text style={styles.txLine}>+{tx.coin} coin → {shortHash(tx.to)}</Text>
        <Text style={styles.txMuted}>Không cần chữ ký, mọi node tự kiểm tra đúng 1 cái/block</Text>
      </View>
    );
  }
  if (tx.type === 'FAUCET') {
    return (
      <View style={styles.tx}>
        <Text style={styles.txType}>FAUCET (tài sản ban đầu)</Text>
        <Text style={styles.txLine}>+{tx.coin} coin, +{tx.nft} NFT → {shortHash(tx.to)}</Text>
        <Text style={styles.txMuted}>Mỗi public key chỉ được nhận đúng một lần</Text>
      </View>
    );
  }
  if (tx.type === 'TRANSFER') {
    return (
      <View style={styles.tx}>
        <Text style={styles.txType}>TRANSFER</Text>
        <Text style={styles.txLine}>{tx.amount} coin</Text>
        <Text style={styles.txLine}>{shortHash(tx.from)} → {shortHash(tx.to)}</Text>
        <Text style={styles.txMuted}>sig {shortHash(tx.signature, 12, 8)}</Text>
      </View>
    );
  }
  return (
    <View style={styles.tx}>
      <Text style={styles.txType}>TRADE</Text>
      <Text style={styles.txLine}>{tx.nftCount} NFT ↔ {tx.coinAmount} coin</Text>
      <Text style={styles.txLine}>mua {shortHash(tx.buyer)}</Text>
      <Text style={styles.txLine}>bán {shortHash(tx.seller)}</Text>
      <Text style={styles.txMuted}>sig mua {shortHash(tx.buyerSignature, 12, 8)}</Text>
      <Text style={styles.txMuted}>sig bán {shortHash(tx.sellerSignature, 12, 8)}</Text>
    </View>
  );
}

export default function LedgerScreen() {
  const state = useNodeState();
  const node = getNode();
  const [validity, setValidity] = useState(null);
  const [checking, setChecking] = useState(false);

  const chain = state.chain;
  const head = state.height;

  // Không tin chain đang giữ: duyệt lại từ block #0, kiểm hash, PoW và mọi chữ ký.
  const recheck = async () => {
    setChecking(true);
    const res = await validateChain(chain);
    setValidity(res);
    setChecking(false);
  };

  useEffect(() => {
    let alive = true;
    validateChain(chain).then((res) => {
      if (alive) setValidity(res);
    });
    return () => {
      alive = false;
    };
  }, [chain]);

  const valid = validity && validity.valid;
  const reorg = state.lastReorg;
  const pending = node ? node.mempool.list() : [];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={checking} onRefresh={recheck} tintColor="#22C55E" />
      }
    >
      {reorg ? (
        <View style={styles.reorgBanner}>
          <Text style={styles.reorgText}>
            Đã chuyển sang nhánh dài hơn, {reorg.replaced} block bị thay thế
          </Text>
          <Text style={styles.reorgSub}>
            {reorg.returnedTxs} giao dịch quay lại mempool ·{' '}
            {new Date(reorg.at).toLocaleTimeString('vi-VN')}
          </Text>
        </View>
      ) : null}

      <View style={[styles.badge, { borderColor: valid ? '#22C55E' : '#EF4444' }]}>
        <Text style={[styles.badgeText, { color: valid ? '#22C55E' : '#EF4444' }]}>
          {validity === null
            ? 'Đang kiểm tra chain…'
            : valid
              ? 'Chain hợp lệ ✓'
              : 'Chain KHÔNG hợp lệ ✗'}
        </Text>
        {validity && !valid ? <Text style={styles.badgeReason}>{validity.reason}</Text> : null}
        <Text style={styles.badgeReason}>
          {chain.length} block · head {shortHash(state.headHash, 10, 6)} · kéo xuống để kiểm lại
        </Text>
      </View>

      <View style={styles.pendingCard}>
        <Text style={styles.sectionTitle}>Mempool — chờ được đào ({pending.length})</Text>
        {pending.length === 0 ? (
          <Text style={styles.txMuted}>Không có giao dịch nào đang chờ.</Text>
        ) : (
          pending.map((tx, i) => (
            <View key={i}>
              <Text style={styles.pendingType}>đang chờ xác nhận</Text>
              <TxRow tx={tx} />
            </View>
          ))
        )}
      </View>

      {chain
        .slice()
        .reverse()
        .map((block) => {
          const miner = (block.transactions || [])[0];
          const confirmations = head - block.index + 1;
          const unsure = confirmations < CONFIRMATIONS_SAFE;
          return (
            <View key={block.hash} style={styles.block}>
              <View style={styles.blockHead}>
                <Text style={styles.blockIndex}>Block #{block.index}</Text>
                <Text style={styles.blockTime}>
                  {new Date(block.timestamp).toLocaleString('vi-VN')}
                </Text>
              </View>

              <Text style={styles.minerLine}>
                {isGenesisBlock(block)
                  ? 'genesis — cả hai máy hardcode giống nhau, không ai đào'
                  : 'đào bởi ' + shortHash(miner ? miner.to : '?', 10, 6)}
              </Text>
              <Text style={[styles.confirm, unsure && styles.confirmUnsure]}>
                {confirmations} xác nhận{unsure ? ' — chưa chắc chắn' : ''}
              </Text>

              <Text style={styles.field}>hash</Text>
              <Text style={styles.mono}>{block.hash}</Text>
              <Text style={styles.field}>previousHash</Text>
              <Text style={styles.mono}>{block.previousHash}</Text>
              <Text style={styles.field}>nonce: {block.nonce}</Text>

              {(block.transactions || []).length === 0 ? (
                <Text style={styles.txMuted}>Không có giao dịch</Text>
              ) : (
                block.transactions.map((tx, i) => <TxRow key={i} tx={tx} />)
              )}
            </View>
          );
        })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F1115' },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  reorgBanner: {
    backgroundColor: 'rgba(245,158,11,0.14)',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  reorgText: { color: '#F59E0B', fontSize: 14, fontWeight: '800' },
  reorgSub: { color: '#9CA3AF', fontSize: 11 },
  badge: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 4 },
  badgeText: { fontSize: 16, fontWeight: '800' },
  badgeReason: { color: '#9CA3AF', fontSize: 12 },
  pendingCard: { backgroundColor: '#1A1D24', borderRadius: 16, padding: 14, gap: 6 },
  sectionTitle: { color: '#9CA3AF', fontSize: 13, fontWeight: '700' },
  pendingType: { color: '#F59E0B', fontSize: 12, fontWeight: '800' },
  block: { backgroundColor: '#1A1D24', borderRadius: 16, padding: 14, gap: 4 },
  blockHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  blockIndex: { color: '#E5E7EB', fontSize: 15, fontWeight: '800' },
  blockTime: { color: '#6B7280', fontSize: 11 },
  minerLine: { color: '#E5E7EB', fontSize: 12, fontFamily: MONO },
  confirm: { color: '#22C55E', fontSize: 12, fontWeight: '700' },
  confirmUnsure: { color: '#F59E0B' },
  field: { color: '#9CA3AF', fontSize: 11, fontWeight: '700', marginTop: 6 },
  mono: { color: '#E5E7EB', fontFamily: MONO, fontSize: 11, lineHeight: 16 },
  tx: {
    backgroundColor: '#0B0D11',
    borderRadius: 16,
    padding: 12,
    marginTop: 8,
    gap: 2,
    borderWidth: 1,
    borderColor: '#22262F',
  },
  txType: { color: '#22C55E', fontSize: 12, fontWeight: '800' },
  txLine: { color: '#E5E7EB', fontSize: 12 },
  txMuted: { color: '#6B7280', fontFamily: MONO, fontSize: 11 },
});

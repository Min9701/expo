import { txid } from '../crypto/sign.js';
import { applyTx, coinsOf, emptyState, nftsOf, verifyTxSignatures } from './consensus.js';

const MAX_POOL = 500;

function cloneState(state) {
  return { coins: { ...state.coins }, nfts: { ...state.nfts } };
}

// Mempool: các giao dịch đã hợp lệ nhưng CHƯA nằm trong block nào.
// Không giữ số dư riêng — mọi kiểm tra đều dựa vào state do ChainStore duyệt lại từ block #0.
export class Mempool {
  constructor(persist) {
    this.txs = [];
    // Hàm lưu xuống AsyncStorage, được tiêm từ ngoài để file này chạy được cả trên Node (test).
    this.persist = persist || (async () => {});
  }

  list() {
    return this.txs.slice();
  }

  size() {
    return this.txs.length;
  }

  has(id) {
    return this.txs.some((tx) => txid(tx) === id);
  }

  async save() {
    try {
      await this.persist(this.txs);
    } catch (e) {
      // Không lưu được thì mempool vẫn chạy trong bộ nhớ, không được làm sập node.
    }
  }

  // Nạp lại mempool đã lưu; tx nào không còn hợp lệ thì bỏ im lặng.
  async load(list, store) {
    this.txs = [];
    if (!Array.isArray(list)) return;
    for (const tx of list) {
      await this.add(tx, store, { silent: true });
    }
  }

  // Nhận tx từ mình hoặc từ gossip. Verify chữ ký + số dư trước khi nhận.
  // COINBASE không bao giờ được vào mempool: nó chỉ sinh ra bởi người đào, trong block.
  async add(tx, store, opts = {}) {
    const id = txid(tx);
    if (!id) return { ok: false, reason: 'Loại giao dịch không nhận dạng được' };
    if (tx.type === 'COINBASE') return { ok: false, reason: 'COINBASE chỉ được tạo khi đào block' };

    if (this.has(id)) return { ok: false, duplicate: true, reason: 'Đã có trong mempool' };
    if (store.txids.has(id)) return { ok: false, duplicate: true, reason: 'Đã nằm trong chain' };

    const sigRes = await verifyTxSignatures(tx);
    if (!sigRes.ok) return { ok: false, reason: sigRes.reason };

    if (tx.type === 'FAUCET') {
      if (store.faucets.has(tx.to)) {
        return { ok: false, reason: 'publicKey này đã nhận FAUCET trong chain rồi' };
      }
      if (this.txs.some((other) => other.type === 'FAUCET' && other.to === tx.to)) {
        return { ok: false, reason: 'Đã có FAUCET của publicKey này đang chờ trong mempool' };
      }
    }

    // Số dư được kiểm tra trên chain đã xác nhận, KHÔNG trừ các tx khác đang chờ.
    // Nhờ vậy hai tx double spend đều vào được mempool, và chỉ một cái thắng khi đóng block.
    const probe = cloneState(store.state);
    const applyRes = applyTx(probe, tx);
    if (!applyRes.ok) return { ok: false, reason: applyRes.reason };

    this.txs.push(tx);
    if (this.txs.length > MAX_POOL) this.txs.shift();
    if (!opts.silent) await this.save();
    return { ok: true, reason: '', id };
  }

  // Chọn giao dịch để đóng vào block mới. Áp lần lượt lên bản copy của state:
  // tx nào làm âm số dư (double spend đến sau) thì bị bỏ lại mempool.
  selectForBlock(state) {
    const probe = cloneState(state);
    const chosen = [];
    const faucetSeen = new Set();

    for (const tx of this.txs) {
      if (tx.type === 'FAUCET') {
        if (faucetSeen.has(tx.to)) continue;
        faucetSeen.add(tx.to);
      }
      if (applyTx(probe, tx).ok) chosen.push(tx);
    }
    return chosen;
  }

  // Block được chấp nhận → gỡ mọi tx có trong block ra khỏi mempool.
  async removeConfirmed(blocks) {
    const confirmed = new Set();
    for (const block of blocks) {
      for (const tx of block.transactions || []) {
        const id = txid(tx);
        if (id) confirmed.add(id);
      }
    }
    if (confirmed.size === 0) return 0;

    const before = this.txs.length;
    this.txs = this.txs.filter((tx) => !confirmed.has(txid(tx)));
    const gone = before - this.txs.length;
    if (gone > 0) await this.save();
    return gone;
  }

  // Fork: block bị mồ côi → TRẢ LẠI giao dịch của nó vào mempool,
  // trừ những tx đã có mặt trong nhánh thắng. COINBASE của block bị bỏ thì mất hẳn.
  async returnOrphaned(removedBlocks, winningTxids) {
    const returned = [];
    for (const block of removedBlocks) {
      for (const tx of block.transactions || []) {
        if (tx.type === 'COINBASE') continue;
        const id = txid(tx);
        if (!id || winningTxids.has(id) || this.has(id)) continue;
        this.txs.push(tx);
        returned.push(tx);
      }
    }
    if (returned.length > 0) await this.save();
    return returned;
  }

  // Sau reorg, tx trả về có thể đã hết hợp lệ (ví dụ tiền đã bị tiêu ở nhánh thắng).
  async prune(store) {
    const probe = cloneState(store.state);
    const kept = [];
    for (const tx of this.txs) {
      const id = txid(tx);
      if (!id || store.txids.has(id)) continue;
      if (tx.type === 'FAUCET' && store.faucets.has(tx.to)) continue;
      if (applyTx(probe, tx).ok) kept.push(tx);
    }
    const changed = kept.length !== this.txs.length;
    this.txs = kept;
    if (changed) await this.save();
    return changed;
  }

  // Số dư "đang chờ": số dư đã xác nhận cộng/trừ các tx còn trong mempool.
  // Chỉ dùng để HIỂN THỊ, không bao giờ dùng để validate.
  pendingState(state) {
    const probe = cloneState(state);
    for (const tx of this.txs) applyTx(probe, tx);
    return probe;
  }

  pendingFor(state, publicKey) {
    const probe = this.pendingState(state);
    return { coins: coinsOf(probe, publicKey), nfts: nftsOf(probe, publicKey) };
  }

  clear() {
    this.txs = [];
  }
}

export function emptyPoolState() {
  return emptyState();
}

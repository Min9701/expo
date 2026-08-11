import { ChainStore, coinsOf, nftsOf } from '../blockchain/consensus.js';
import { Mempool } from '../blockchain/mempool.js';
import { createCoinbaseTx, createFaucetTx, mineBlock } from '../blockchain/miner.js';
import { shortHash } from '../blockchain/Block.js';
import { GET_CHAIN_LOOKBACK, PING_INTERVAL_MS } from '../config.js';
import { txid } from '../crypto/sign.js';

// NodeCore = toàn bộ trí tuệ của một full node: giữ chain, tự validate, tự đào,
// tự giải quyết fork. Không biết gì về React hay AsyncStorage — transport và storage
// đều được tiêm vào, nên file này chạy được cả trên điện thoại và trên Node (script test).

export class NodeCore {
  constructor({ identity, send, persistChain, persistMempool, persistOrders, onEvent }) {
    this.identity = identity || null;
    this.send = send || (() => {});
    this.persistChain = persistChain || (async () => {});
    this.persistOrders = persistOrders || (async () => {});
    this.onEvent = onEvent || (() => {});

    this.store = new ChainStore();
    this.mempool = new Mempool(persistMempool);
    this.orders = [];

    this.mining = false;
    this.miningStats = { nonce: 0, hashrate: 0, minedByMe: 0 };
    // Tăng mỗi khi head đổi vì block từ mạng → vòng đào đang chạy tự huỷ.
    this.headEpoch = 0;
    this.lastReorg = null;
  }

  // --- vòng đời ------------------------------------------------------------
  async start({ chain, mempool, orders } = {}) {
    const res = await this.store.load(chain);
    if (!res.ok && Array.isArray(chain) && chain.length > 0) {
      this.log('warn', 'Chain đã lưu không hợp lệ (' + res.reason + ') — bắt đầu lại từ genesis');
    }
    await this.mempool.load(mempool, this.store);
    this.orders = Array.isArray(orders) ? orders : [];
    this.emitState();
  }

  setIdentity(identity) {
    this.identity = identity;
    this.emitState();
  }

  log(level, message) {
    this.onEvent({ kind: 'log', level, message, at: Date.now() });
  }

  emitState() {
    this.onEvent({ kind: 'state' });
  }

  snapshot() {
    const key = this.identity ? this.identity.publicKey : null;
    const confirmed = { coins: 0, nfts: 0 };
    const pending = { coins: 0, nfts: 0 };
    if (key) {
      confirmed.coins = coinsOf(this.store.state, key);
      confirmed.nfts = nftsOf(this.store.state, key);
      const p = this.mempool.pendingFor(this.store.state, key);
      pending.coins = p.coins;
      pending.nfts = p.nfts;
    }
    return {
      height: this.store.height(),
      blocks: this.store.chain.length,
      headHash: this.store.head().hash,
      mempoolSize: this.mempool.size(),
      orphanCount: this.store.orphans.size,
      mining: this.mining,
      miningStats: { ...this.miningStats },
      lastReorg: this.lastReorg,
      confirmed,
      pending,
      chain: this.store.chain,
      orders: this.orders.slice(),
    };
  }

  // --- gossip đi -----------------------------------------------------------
  gossip(type, payload) {
    this.send({ type, ...payload });
  }

  sendPingHeight() {
    this.gossip('PING_HEIGHT', { height: this.store.height(), headHash: this.store.head().hash });
  }

  requestChain(fromIndex) {
    const from = Math.max(0, fromIndex);
    this.gossip('GET_CHAIN', { fromIndex: from });
  }

  // Định kỳ khoe chiều cao chain của mình. Node nào thấp hơn sẽ tự xin phần thiếu.
  startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.sendPingHeight(), PING_INTERVAL_MS);
    this.sendPingHeight();
  }

  stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  // --- gossip vào ----------------------------------------------------------
  async handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'INV_BLOCK') return this.onIncomingBlock(msg.block, true);
    if (msg.type === 'INV_TX') return this.onIncomingTx(msg.transaction, true);
    if (msg.type === 'INV_ORDER') return this.onIncomingOrder(msg.order);
    if (msg.type === 'ORDER_FILLED') return this.onOrderClosed(msg.orderId, 'FILLED');
    if (msg.type === 'ORDER_REJECTED') return this.onOrderClosed(msg.orderId, 'REJECTED');
    if (msg.type === 'GET_CHAIN') {
      const blocks = this.store.blocksFrom(Number(msg.fromIndex) || 0);
      if (blocks.length > 0) this.gossip('CHAIN_DATA', { blocks });
      return;
    }
    if (msg.type === 'CHAIN_DATA') return this.onChainData(msg.blocks);
    if (msg.type === 'PING_HEIGHT') return this.onPingHeight(msg);
  }

  // Cơ chế tự bắt kịp: ai khoe cao hơn thì mình xin phần thiếu.
  async onPingHeight(msg) {
    const theirHeight = Number(msg.height);
    if (!Number.isFinite(theirHeight)) return;
    const mine = this.store.height();

    if (theirHeight > mine) {
      this.log('info', 'Node khác cao hơn (' + theirHeight + ' > ' + mine + ') — xin phần thiếu');
      this.requestChain(mine - GET_CHAIN_LOOKBACK + 1);
      return;
    }

    // Người kia đang thấp hơn: khoe lại chiều cao của mình để họ biết mà xin,
    // thay vì phải đợi hết nhịp heartbeat 10 giây. Không tạo vòng lặp vì node cao hơn
    // chỉ trả lời bằng GET_CHAIN, và hai node bằng nhau thì cả hai đều im lặng.
    if (theirHeight < mine) this.sendPingHeight();
  }

  async onChainData(blocks) {
    if (!Array.isArray(blocks)) return;
    // Xếp theo index để block cha luôn tới trước con.
    const sorted = blocks.slice().sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const block of sorted) {
      await this.onIncomingBlock(block, false);
    }
  }

  async onIncomingBlock(block, relay) {
    if (!block) return { status: 'INVALID', reason: 'Không có block' };

    const res = await this.store.receiveBlock(block);

    if (res.status === 'INVALID') {
      this.log('error', 'TỪ CHỐI block #' + block.index + ': ' + res.reason);
      return res;
    }
    if (res.status === 'DUPLICATE') return res;

    if (res.status === 'ORPHAN') {
      this.log('warn', 'Block #' + block.index + ' đến trước cha — cho vào kho mồ côi, xin phần thiếu');
      this.requestChain(Math.max(0, Math.min(block.index - 1, this.store.height() + 1) - GET_CHAIN_LOOKBACK + 1));
      this.emitState();
      return res;
    }
    if (res.status === 'SIDE_BRANCH') {
      this.log('warn', 'Nhánh khác hợp lệ nhưng không dài hơn — giữ nguyên chain hiện tại');
      this.emitState();
      return res;
    }

    // EXTENDED hoặc REORG: chain chính đã đổi.
    await this.afterChainChanged(res);
    if (relay) this.gossip('INV_BLOCK', { block });
    return res;
  }

  async afterChainChanged(res) {
    // Block mới → huỷ vòng đào đang chạy, đào lại trên head mới.
    this.headEpoch += 1;

    await this.mempool.removeConfirmed(res.added || []);

    if ((res.removed || []).length > 0) {
      const returned = await this.mempool.returnOrphaned(res.removed, this.store.txids);
      this.lastReorg = {
        at: Date.now(),
        replaced: res.removed.length,
        adopted: (res.added || []).length,
        returnedTxs: returned.length,
      };
      this.log(
        'warn',
        'REORG: chuyển sang nhánh dài hơn, ' + res.removed.length + ' block bị thay thế, ' +
          returned.length + ' giao dịch quay lại mempool'
      );
    }

    await this.mempool.prune(this.store);
    await this.persistChain(this.store.chain);

    for (const block of res.added || []) {
      const miner = (block.transactions || [])[0];
      this.log(
        'info',
        'Nhận block #' + block.index + ' (' + shortHash(block.hash, 8, 4) + ') do ' +
          shortHash(miner ? miner.to : '?', 6, 4) + ' đào'
      );
    }

    // Lệnh TRADE đã được đóng vào block thì không còn phải chờ bên bán nữa.
    await this.closeOrdersInBlocks(res.added || []);
    this.emitState();
  }

  async onIncomingTx(tx, relay) {
    if (!tx) return { ok: false, reason: 'Không có giao dịch' };
    const res = await this.mempool.add(tx, this.store);
    if (res.ok) {
      this.log('info', 'Nhận giao dịch ' + tx.type + ' vào mempool (' + shortHash(res.id, 8, 4) + ')');
      if (relay) this.gossip('INV_TX', { transaction: tx });
      this.emitState();
    } else if (!res.duplicate) {
      this.log('error', 'TỪ CHỐI giao dịch ' + tx.type + ': ' + res.reason);
    }
    return res;
  }

  // --- hành động của người dùng -------------------------------------------
  async submitTransaction(tx) {
    const res = await this.mempool.add(tx, this.store);
    if (!res.ok) return res;
    this.gossip('INV_TX', { transaction: tx });
    this.log('info', 'Đã phát giao dịch ' + tx.type + ' ra mạng, đang chờ được đào');
    this.emitState();
    return res;
  }

  // FAUCET: không phải server phát, mà là một giao dịch được toàn mạng kiểm chứng.
  async requestFaucet() {
    if (!this.identity) return { ok: false, reason: 'Chưa đăng nhập' };
    const key = this.identity.publicKey;
    if (this.store.faucets.has(key)) return { ok: false, reason: 'Ví này đã nhận FAUCET rồi' };
    if (this.mempool.list().some((tx) => tx.type === 'FAUCET' && tx.to === key)) {
      return { ok: false, reason: 'FAUCET của ví này đang chờ được đào' };
    }
    return this.submitTransaction(createFaucetTx(key));
  }

  // --- lệnh TRADE đang chờ bên bán ký (không thuộc đồng thuận) -------------
  async submitOrder(order) {
    this.orders = this.orders.filter((o) => o.id !== order.id).concat([order]);
    await this.persistOrders(this.orders);
    this.gossip('INV_ORDER', { order });
    this.emitState();
  }

  async onIncomingOrder(order) {
    if (!order || !order.id) return;
    if (this.orders.some((o) => o.id === order.id)) return;
    this.orders = this.orders.concat([{ ...order, status: order.status || 'AWAITING_SELLER' }]);
    await this.persistOrders(this.orders);
    this.log('info', 'Có lệnh mua mới cần bạn xác nhận: ' + order.nftCount + ' NFT / ' + order.coinAmount + ' coin');
    this.onEvent({ kind: 'order', order });
    this.emitState();
  }

  async onOrderClosed(orderId, status) {
    if (!this.orders.some((o) => o.id === orderId)) return;
    this.orders = this.orders.map((o) => (o.id === orderId ? { ...o, status } : o));
    await this.persistOrders(this.orders);
    this.emitState();
  }

  async closeOrder(orderId, status) {
    await this.onOrderClosed(orderId, status);
    this.gossip(status === 'FILLED' ? 'ORDER_FILLED' : 'ORDER_REJECTED', { orderId });
  }

  async closeOrdersInBlocks(blocks) {
    let changed = false;
    for (const block of blocks) {
      for (const tx of block.transactions || []) {
        if (tx.type !== 'TRADE') continue;
        const id = txid(tx);
        if (this.orders.some((o) => o.id === id && o.status !== 'FILLED')) {
          this.orders = this.orders.map((o) => (o.id === id ? { ...o, status: 'FILLED' } : o));
          changed = true;
        }
      }
    }
    if (changed) await this.persistOrders(this.orders);
  }

  // --- đào ----------------------------------------------------------------
  startMining() {
    if (this.mining || !this.identity) return;
    this.mining = true;
    this.emitState();
    this.runMiningLoop();
  }

  stopMining() {
    this.mining = false;
    this.miningStats.nonce = 0;
    this.miningStats.hashrate = 0;
    this.emitState();
  }

  async runMiningLoop() {
    while (this.mining) {
      const parent = this.store.head();
      const epoch = this.headEpoch;
      const coinbase = createCoinbaseTx(this.identity.publicKey, parent.index + 1);
      const transactions = [coinbase, ...this.mempool.selectForBlock(this.store.state)];

      const res = await mineBlock({
        parent,
        transactions,
        shouldStop: () => !this.mining || this.headEpoch !== epoch,
        onProgress: ({ nonce, hashrate }) => {
          this.miningStats.nonce = nonce;
          this.miningStats.hashrate = hashrate;
          this.emitState();
        },
      });

      if (res.cancelled) {
        // Có người đào trước, hoặc người dùng bấm dừng: bỏ vòng này, dựng lại trên head mới.
        continue;
      }

      const accept = await this.store.receiveBlock(res.block);
      if (accept.status !== 'EXTENDED' && accept.status !== 'REORG') {
        this.log('warn', 'Block mình vừa đào không nối được (' + accept.status + ': ' + accept.reason + ')');
        continue;
      }

      this.miningStats.minedByMe += 1;
      this.log(
        'success',
        'ĐÀO ĐƯỢC block #' + res.block.index + ' (' + shortHash(res.block.hash, 8, 4) + ') sau ' +
          res.tried + ' nonce, ' + res.ms + 'ms'
      );
      await this.afterChainChanged(accept);
      this.gossip('INV_BLOCK', { block: res.block });
    }
  }
}

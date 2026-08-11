import {
  COINBASE_REWARD,
  FAUCET_COIN,
  FAUCET_NFT,
  GENESIS_TIMESTAMP,
  POW_PREFIX,
} from '../config.js';
import { txid, verifySignature } from '../crypto/sign.js';
import { computeHash, hasValidProofOfWork, shortHash } from './Block.js';
import { GENESIS_HASH, genesisBlock } from './genesis.js';

const HEX_PUB = /^[0-9a-f]{66}$/;

const ok = () => ({ ok: true, reason: '' });
const fail = (reason) => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// Trạng thái (số dư + số NFT) KHÔNG BAO GIỜ được lưu rời. Nó luôn là kết quả
// của việc duyệt lại chain chính từ block #0 qua validateChain().
// ---------------------------------------------------------------------------
export function emptyState() {
  return { coins: {}, nfts: {} };
}

function cloneState(state) {
  return { coins: { ...state.coins }, nfts: { ...state.nfts } };
}

export function coinsOf(state, publicKey) {
  return state.coins[publicKey] || 0;
}

export function nftsOf(state, publicKey) {
  return state.nfts[publicKey] || 0;
}

function credit(state, key, coin, nft) {
  if (coin) state.coins[key] = (state.coins[key] || 0) + coin;
  if (nft) state.nfts[key] = (state.nfts[key] || 0) + nft;
}

// ---------------------------------------------------------------------------
// Kiểm tra hình dạng + chữ ký của MỘT giao dịch (chưa xét số dư).
// ---------------------------------------------------------------------------
export async function verifyTxSignatures(tx) {
  if (!tx || typeof tx !== 'object') return fail('Giao dịch rỗng');

  if (tx.type === 'COINBASE') {
    if (!HEX_PUB.test(String(tx.to))) return fail('COINBASE có người nhận không phải public key 66 hex');
    if (tx.coin !== COINBASE_REWARD) {
      return fail('COINBASE phải đúng ' + COINBASE_REWARD + ' coin, block này ghi ' + tx.coin);
    }
    if (!Number.isInteger(tx.blockIndex)) return fail('COINBASE thiếu blockIndex');
    return ok();
  }

  if (tx.type === 'FAUCET') {
    if (!HEX_PUB.test(String(tx.to))) return fail('FAUCET có người nhận không phải public key 66 hex');
    if (tx.coin !== FAUCET_COIN || tx.nft !== FAUCET_NFT) {
      return fail('FAUCET phải đúng ' + FAUCET_COIN + ' coin và ' + FAUCET_NFT + ' NFT');
    }
    if (typeof tx.timestamp !== 'number') return fail('FAUCET thiếu timestamp');
    return ok();
  }

  if (tx.type === 'TRANSFER') {
    if (!HEX_PUB.test(String(tx.from))) return fail('TRANSFER có người gửi không hợp lệ');
    if (!HEX_PUB.test(String(tx.to))) return fail('TRANSFER có người nhận không hợp lệ');
    if (tx.from === tx.to) return fail('TRANSFER tự gửi cho chính mình');
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) return fail('TRANSFER có amount không hợp lệ');
    if (!tx.signature) return fail('TRANSFER thiếu chữ ký');
    const good = await verifySignature(tx, tx.signature, tx.from);
    return good ? ok() : fail('Chữ ký TRANSFER không khớp public key người gửi');
  }

  if (tx.type === 'TRADE') {
    if (!HEX_PUB.test(String(tx.buyer))) return fail('TRADE có bên mua không hợp lệ');
    if (!HEX_PUB.test(String(tx.seller))) return fail('TRADE có bên bán không hợp lệ');
    if (tx.buyer === tx.seller) return fail('TRADE có bên mua trùng bên bán');
    if (!Number.isInteger(tx.nftCount) || tx.nftCount <= 0) return fail('TRADE có nftCount không hợp lệ');
    if (!Number.isFinite(tx.coinAmount) || tx.coinAmount <= 0) {
      return fail('TRADE có coinAmount không hợp lệ');
    }
    if (!tx.buyerSignature) return fail('TRADE thiếu chữ ký bên mua');
    if (!tx.sellerSignature) return fail('TRADE thiếu chữ ký bên bán');
    const buyerOk = await verifySignature(tx, tx.buyerSignature, tx.buyer);
    if (!buyerOk) return fail('Chữ ký bên mua không hợp lệ');
    const sellerOk = await verifySignature(tx, tx.sellerSignature, tx.seller);
    if (!sellerOk) return fail('Chữ ký bên bán không hợp lệ');
    return ok();
  }

  return fail('Loại giao dịch không nhận dạng được: ' + String(tx && tx.type));
}

// Trừ/cộng số dư. Trả lỗi nếu tiêu quá số dư — đây là chỗ chặn double spend.
export function applyTx(state, tx) {
  if (tx.type === 'COINBASE' || tx.type === 'FAUCET') {
    credit(state, tx.to, tx.coin, tx.nft || 0);
    return ok();
  }

  if (tx.type === 'TRANSFER') {
    if (coinsOf(state, tx.from) < tx.amount) {
      return fail(
        'Tiêu quá số dư: ' + shortHash(tx.from, 8, 4) + ' chỉ có ' +
          coinsOf(state, tx.from) + ' coin, cần ' + tx.amount
      );
    }
    credit(state, tx.from, -tx.amount, 0);
    credit(state, tx.to, tx.amount, 0);
    return ok();
  }

  if (tx.type === 'TRADE') {
    if (coinsOf(state, tx.buyer) < tx.coinAmount) {
      return fail(
        'Bên mua không đủ coin: có ' + coinsOf(state, tx.buyer) + ', cần ' + tx.coinAmount
      );
    }
    if (nftsOf(state, tx.seller) < tx.nftCount) {
      return fail('Bên bán không đủ NFT: có ' + nftsOf(state, tx.seller) + ', cần ' + tx.nftCount);
    }
    credit(state, tx.buyer, -tx.coinAmount, tx.nftCount);
    credit(state, tx.seller, tx.coinAmount, -tx.nftCount);
    return ok();
  }

  return fail('Loại giao dịch không áp dụng được: ' + String(tx.type));
}

// ---------------------------------------------------------------------------
// Validate block #0: phải đúng genesis dùng chung.
// ---------------------------------------------------------------------------
export function validateGenesis(block) {
  if (!block || typeof block !== 'object') return fail('Genesis rỗng');
  if (block.index !== 0) return fail('Genesis phải có index 0');
  if (block.previousHash !== '0') return fail('Genesis phải có previousHash "0"');
  if (block.timestamp !== GENESIS_TIMESTAMP) return fail('Genesis có timestamp không đúng hằng số chung');
  if ((block.transactions || []).length !== 0) return fail('Genesis phải không có giao dịch');
  if (computeHash(block) !== block.hash) return fail('Genesis có hash không khớp nội dung');
  if (!hasValidProofOfWork(block)) return fail('Genesis không đạt proof-of-work');
  if (block.hash !== GENESIS_HASH) {
    return fail('Genesis khác genesis của node này — hai máy đang chạy hai mạng khác nhau');
  }
  return ok();
}

// ---------------------------------------------------------------------------
// Validate MỘT block trên nền ctx (trạng thái ngay TRƯỚC block đó).
// ctx = { state, txids:Set, faucets:Set }. Chỉ ghi vào ctx khi block hợp lệ hoàn toàn.
// ---------------------------------------------------------------------------
export async function validateBlockInto(block, parent, ctx) {
  if (!block || typeof block !== 'object') return fail('Block rỗng');
  if (!Number.isInteger(block.index)) return fail('index không phải số nguyên');
  if (typeof block.timestamp !== 'number') return fail('timestamp không phải số');
  if (!Array.isArray(block.transactions)) return fail('transactions không phải mảng');
  if (typeof block.previousHash !== 'string') return fail('previousHash không phải chuỗi');
  if (!Number.isInteger(block.nonce)) return fail('nonce không phải số nguyên');

  if (computeHash(block) !== block.hash) return fail('Hash ghi trong block không khớp nội dung block');
  if (!hasValidProofOfWork(block)) {
    return fail('Hash không bắt đầu bằng "' + POW_PREFIX + '" — proof-of-work sai');
  }
  if (block.index !== parent.index + 1) {
    return fail('index sai: phải là ' + (parent.index + 1) + ', block ghi ' + block.index);
  }
  if (block.previousHash !== parent.hash) {
    return fail(
      'previousHash không khớp block cha (' + shortHash(block.previousHash) + ' ≠ ' + shortHash(parent.hash) + ')'
    );
  }
  if (block.timestamp < parent.timestamp) return fail('timestamp sớm hơn block cha');

  const txs = block.transactions;
  if (txs.length === 0) return fail('Block không có giao dịch nào — thiếu coinbase');
  if (txs[0].type !== 'COINBASE') return fail('Giao dịch đầu tiên phải là COINBASE');
  for (let i = 1; i < txs.length; i += 1) {
    if (txs[i].type === 'COINBASE') return fail('Block có nhiều hơn một COINBASE');
  }
  if (txs[0].blockIndex !== block.index) return fail('COINBASE có blockIndex không khớp index của block');

  // Làm việc trên bản copy: block sai ở giao dịch thứ n không được để lại dấu vết.
  const draft = {
    state: cloneState(ctx.state),
    txids: new Set(ctx.txids),
    faucets: new Set(ctx.faucets),
  };

  for (let i = 0; i < txs.length; i += 1) {
    const tx = txs[i];
    const label = 'Giao dịch #' + i + ' (' + String(tx && tx.type) + '): ';

    const id = txid(tx);
    if (!id) return fail(label + 'không tính được txid, loại giao dịch không hợp lệ');
    if (draft.txids.has(id)) return fail(label + 'trùng giao dịch đã có trong chain hoặc trong block này');

    const sigRes = await verifyTxSignatures(tx);
    if (!sigRes.ok) return fail(label + sigRes.reason);

    // LUẬT: mỗi publicKey chỉ nhận FAUCET đúng một lần trong toàn bộ chain.
    if (tx.type === 'FAUCET') {
      if (draft.faucets.has(tx.to)) {
        return fail(label + 'publicKey ' + shortHash(tx.to, 8, 4) + ' đã nhận FAUCET trước đó rồi');
      }
      draft.faucets.add(tx.to);
    }

    const applyRes = applyTx(draft.state, tx);
    if (!applyRes.ok) return fail(label + applyRes.reason);

    draft.txids.add(id);
  }

  ctx.state = draft.state;
  ctx.txids = draft.txids;
  ctx.faucets = draft.faucets;
  return ok();
}

// ---------------------------------------------------------------------------
// Duyệt lại TOÀN BỘ chain từ block #0. Đây là hàm quyết định một chain có hợp lệ
// hay không, và là nguồn duy nhất của số dư.
// ---------------------------------------------------------------------------
export async function validateChain(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { valid: false, reason: 'Chain rỗng', state: emptyState(), txids: new Set(), faucets: new Set() };
  }

  const gen = validateGenesis(blocks[0]);
  if (!gen.ok) return { valid: false, reason: 'Block #0: ' + gen.reason, state: emptyState(), txids: new Set(), faucets: new Set() };

  const ctx = { state: emptyState(), txids: new Set(), faucets: new Set() };

  for (let i = 1; i < blocks.length; i += 1) {
    const res = await validateBlockInto(blocks[i], blocks[i - 1], ctx);
    if (!res.ok) {
      return { valid: false, reason: 'Block #' + blocks[i].index + ': ' + res.reason, state: ctx.state, txids: ctx.txids, faucets: ctx.faucets };
    }
  }

  return { valid: true, reason: '', state: ctx.state, txids: ctx.txids, faucets: ctx.faucets };
}

export function chainTxidSet(blocks) {
  const set = new Set();
  for (const block of blocks) {
    for (const tx of block.transactions || []) {
      const id = txid(tx);
      if (id) set.add(id);
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// ChainStore: chain chính + mọi block từng thấy + kho block mồ côi.
// Toàn bộ luật chuỗi dài nhất nằm ở đây.
// ---------------------------------------------------------------------------
export class ChainStore {
  constructor() {
    this.chain = [genesisBlock()];
    this.known = new Map(); // hash -> block, gồm cả block của nhánh phụ
    this.orphans = new Map(); // hash -> block chưa tìm được cha
    this.state = emptyState();
    this.txids = new Set();
    this.faucets = new Set();
  }

  head() {
    return this.chain[this.chain.length - 1];
  }

  // Chiều cao = index của block cuối. Genesis đứng một mình → 0.
  height() {
    return this.head().index;
  }

  hasBlock(hash) {
    return this.known.has(hash) || this.chain.some((b) => b.hash === hash);
  }

  blocksFrom(fromIndex) {
    const start = Math.max(0, Math.min(fromIndex, this.chain.length));
    return this.chain.slice(start);
  }

  // Nạp chain đã lưu trong máy. Dữ liệu hỏng/khác genesis → quay về chain chỉ có genesis.
  async load(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      this.reset();
      return { ok: false, reason: 'Không có chain đã lưu' };
    }
    const res = await validateChain(blocks);
    if (!res.valid) {
      this.reset();
      return { ok: false, reason: res.reason };
    }
    this.chain = blocks;
    this.state = res.state;
    this.txids = res.txids;
    this.faucets = res.faucets;
    this.known = new Map(blocks.map((b) => [b.hash, b]));
    this.orphans = new Map();
    return { ok: true, reason: '' };
  }

  reset() {
    const gen = genesisBlock();
    this.chain = [gen];
    this.known = new Map([[gen.hash, gen]]);
    this.orphans = new Map();
    this.state = emptyState();
    this.txids = new Set();
    this.faucets = new Set();
  }

  confirmationsOf(blockIndex) {
    // Quy ước Bitcoin: block ở đỉnh chain có 1 xác nhận.
    return this.height() - blockIndex + 1;
  }

  findBlockOfTx(id) {
    for (const block of this.chain) {
      for (const tx of block.transactions || []) {
        if (txid(tx) === id) return block;
      }
    }
    return null;
  }

  // Nhận một block từ mạng (hoặc từ miner của chính mình).
  // Trả về:
  //  EXTENDED    — nối thẳng vào head
  //  REORG       — đã chuyển sang nhánh dài hơn (kèm removed/added)
  //  SIDE_BRANCH — hợp lệ nhưng không dài hơn, chỉ lưu lại
  //  ORPHAN      — chưa có cha, đã cho vào kho mồ côi
  //  DUPLICATE / INVALID
  async receiveBlock(block) {
    if (!block || typeof block.hash !== 'string' || !block.hash) {
      return { status: 'INVALID', reason: 'Block không có hash' };
    }
    if (this.hasBlock(block.hash)) return { status: 'DUPLICATE', reason: 'Đã biết block này' };

    // Chặn rác trước khi cho vào bộ nhớ: hash phải tự khớp và phải có proof-of-work.
    if (computeHash(block) !== block.hash) {
      return { status: 'INVALID', reason: 'Hash ghi trong block không khớp nội dung block' };
    }
    if (!hasValidProofOfWork(block)) {
      return { status: 'INVALID', reason: 'Hash không bắt đầu bằng "' + POW_PREFIX + '" — proof-of-work sai' };
    }

    this.known.set(block.hash, block);
    const res = await this.connect(block);

    if (res.status === 'INVALID') this.known.delete(block.hash);
    if (res.status === 'EXTENDED' || res.status === 'REORG') {
      const extra = await this.connectOrphans();
      if (extra.added.length > 0) {
        // Gộp kết quả để phía trên chỉ phải xử lý một lần.
        res.added = res.added.concat(extra.added.filter((b) => !res.added.includes(b)));
        res.removed = res.removed.concat(extra.removed);
        if (extra.reorg) res.status = 'REORG';
      }
    }
    return res;
  }

  // Dựng nhánh chứa block, tìm điểm rẽ với chain chính, validate cả nhánh, so độ dài.
  async connect(block) {
    const branch = [];
    const seen = new Set();
    let cursor = block;
    let forkIdx = -1;

    while (true) {
      if (seen.has(cursor.hash)) {
        return { status: 'INVALID', reason: 'previousHash tạo thành vòng lặp' };
      }
      seen.add(cursor.hash);
      branch.unshift(cursor);

      forkIdx = this.chain.findIndex((b) => b.hash === cursor.previousHash);
      if (forkIdx >= 0) break;

      const parent = this.known.get(cursor.previousHash);
      if (!parent) {
        this.orphans.set(block.hash, block);
        return {
          status: 'ORPHAN',
          reason: 'Chưa có block cha ' + shortHash(cursor.previousHash),
          missingHash: cursor.previousHash,
        };
      }
      cursor = parent;
    }

    const candidate = this.chain.slice(0, forkIdx + 1).concat(branch);
    const res = await validateChain(candidate);
    if (!res.valid) return { status: 'INVALID', reason: res.reason };

    // LUẬT CHUỖI DÀI NHẤT: chỉ đổi chain khi nhánh mới thực sự dài hơn.
    // Bằng nhau thì giữ nguyên nhánh đang có (nhánh nào đến trước thì thắng).
    if (candidate.length <= this.chain.length) {
      this.orphans.delete(block.hash);
      return {
        status: 'SIDE_BRANCH',
        reason: 'Nhánh hợp lệ nhưng không dài hơn (' + candidate.length + ' ≤ ' + this.chain.length + ')',
        added: [],
        removed: [],
      };
    }

    const removed = this.chain.slice(forkIdx + 1);
    this.chain = candidate;
    this.state = res.state;
    this.txids = res.txids;
    this.faucets = res.faucets;
    this.orphans.delete(block.hash);

    return {
      status: removed.length > 0 ? 'REORG' : 'EXTENDED',
      reason: '',
      added: branch,
      removed,
    };
  }

  // Block đến trước cha của nó: sau khi có cha thì thử nối lại, lặp tới khi hết nối được.
  async connectOrphans() {
    const added = [];
    const removed = [];
    let reorg = false;
    let progress = true;

    while (progress) {
      progress = false;
      for (const orphan of Array.from(this.orphans.values())) {
        const res = await this.connect(orphan);
        if (res.status === 'EXTENDED' || res.status === 'REORG') {
          added.push(...res.added);
          removed.push(...res.removed);
          if (res.status === 'REORG') reorg = true;
          progress = true;
        } else if (res.status === 'INVALID' || res.status === 'SIDE_BRANCH') {
          this.orphans.delete(orphan.hash);
          if (res.status === 'INVALID') this.known.delete(orphan.hash);
        }
      }
    }

    return { added, removed, reorg };
  }
}

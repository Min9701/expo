import { COINBASE_REWARD, FAUCET_COIN, FAUCET_NFT, MINE_BATCH, POW_PREFIX } from '../config.js';
import { makeNonce } from '../crypto/sign.js';
import { computeHash, createBlock } from './Block.js';

// Nhả luồng cho UI. JS chạy một luồng: không có dòng này thì vòng đào đóng băng cả app.
const yieldToUI = () => new Promise((resolve) => setTimeout(resolve, 0));

export function createCoinbaseTx(publicKey, blockIndex) {
  return {
    type: 'COINBASE',
    to: publicKey,
    coin: COINBASE_REWARD,
    blockIndex,
    nonce: makeNonce(),
  };
}

export function createFaucetTx(publicKey) {
  return {
    type: 'FAUCET',
    to: publicKey,
    coin: FAUCET_COIN,
    nft: FAUCET_NFT,
    timestamp: Date.now(),
    nonce: makeNonce(),
  };
}

// Đào một block trên nền parent. Cứ MINE_BATCH nonce lại nhả luồng một lần rồi hỏi
// shouldStop(): nhờ vậy khi có block mới từ node khác, vòng đào hiện tại bị HỦY ngay.
export async function mineBlock({ parent, transactions, shouldStop, onProgress }) {
  // timestamp không được sớm hơn block cha, kể cả khi đồng hồ hai máy lệch nhau.
  const timestamp = Math.max(Date.now(), parent.timestamp);
  const candidate = createBlock(parent.index + 1, transactions, parent.hash, timestamp);

  const startedAt = Date.now();
  let tried = 0;

  for (let nonce = 0; ; nonce += 1) {
    candidate.nonce = nonce;
    const hash = computeHash(candidate);
    tried += 1;

    if (hash.startsWith(POW_PREFIX)) {
      candidate.hash = hash;
      return { block: candidate, cancelled: false, tried, ms: Date.now() - startedAt };
    }

    if (tried % MINE_BATCH === 0) {
      await yieldToUI();
      if (shouldStop && shouldStop()) {
        return { block: null, cancelled: true, tried, ms: Date.now() - startedAt };
      }
      if (onProgress) {
        const ms = Date.now() - startedAt;
        onProgress({ nonce, tried, hashrate: ms > 0 ? Math.round((tried / ms) * 1000) : 0 });
      }
    }
  }
}

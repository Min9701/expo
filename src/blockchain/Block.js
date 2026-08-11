import { POW_PREFIX } from '../config.js';
import { sha256Hex, utf8ToBytes } from '../crypto/keys.js';

// Thứ tự field ở đây LÀ luật đồng thuận: đổi thứ tự là hash khác, hai node hết đồng bộ.
export function blockContent(block) {
  return JSON.stringify({
    index: block.index,
    timestamp: block.timestamp,
    transactions: block.transactions,
    previousHash: block.previousHash,
    nonce: block.nonce,
  });
}

export function computeHash(block) {
  return sha256Hex(utf8ToBytes(blockContent(block)));
}

export function createBlock(index, transactions, previousHash, timestamp) {
  return {
    index,
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
    transactions,
    previousHash,
    nonce: 0,
    hash: '',
  };
}

export function hasValidProofOfWork(block) {
  return typeof block.hash === 'string' && block.hash.startsWith(POW_PREFIX);
}

export function shortHash(hash, head = 10, tail = 6) {
  const s = String(hash || '');
  return s.length > head + tail + 1 ? s.slice(0, head) + '…' + s.slice(-tail) : s;
}

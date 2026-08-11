import { GENESIS_TIMESTAMP } from '../config.js';
import { computeHash, hasValidProofOfWork } from './Block.js';

// Block #0 phải GIỐNG HỆT nhau trên mọi máy, byte-for-byte.
// Vì vậy nonce ở đây được đào sẵn một lần trên laptop rồi hardcode, và timestamp là
// hằng số. TUYỆT ĐỐI KHÔNG sinh genesis bằng Date.now(): mỗi máy sẽ ra một hash gốc
// khác nhau và hai chain vĩnh viễn không nối được vào nhau.
const GENESIS = Object.freeze({
  index: 0,
  timestamp: GENESIS_TIMESTAMP,
  transactions: [],
  previousHash: '0',
  nonce: 725,
  hash: '0006fcf0988203df328d83ec58bda33147f02bf908df05307f63deab9e840f30',
});

export const GENESIS_HASH = GENESIS.hash;

export function genesisBlock() {
  // Trả bản copy để không ai sửa được hằng số dùng chung.
  return { ...GENESIS, transactions: [] };
}

export function isGenesisBlock(block) {
  return !!block && block.index === 0 && block.hash === GENESIS.hash;
}

// Chạy lúc khởi động: nếu hằng số hardcode bị sửa lệch thì phải phát hiện ngay,
// chứ không để tới lúc hai máy không đồng bộ mới đi tìm nguyên nhân.
export function genesisSelfCheck() {
  const block = genesisBlock();
  if (computeHash(block) !== GENESIS.hash) {
    return { ok: false, reason: 'Hash genesis hardcode không khớp nội dung genesis' };
  }
  if (!hasValidProofOfWork(block)) {
    return { ok: false, reason: 'Genesis không đạt proof-of-work' };
  }
  return { ok: true, reason: '' };
}

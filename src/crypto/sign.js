import { bytesToHex, hexToBytes, secp, sha256, sha256Hex, utf8ToBytes } from './keys.js';

// Payload được dựng bằng hàm chung để thứ tự field trong JSON.stringify
// luôn giống nhau ở phía ký và phía xác minh — lệch thứ tự là hash khác, verify sai.
// Payload cũng là cơ sở tính txid, nên hai node luôn ra cùng một txid cho cùng giao dịch.

export function transferPayload(tx) {
  return {
    type: 'TRANSFER',
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    timestamp: tx.timestamp,
    nonce: tx.nonce,
  };
}

export function tradePayload(tx) {
  return {
    type: 'TRADE',
    buyer: tx.buyer,
    seller: tx.seller,
    nftCount: tx.nftCount,
    coinAmount: tx.coinAmount,
    timestamp: tx.timestamp,
    nonce: tx.nonce,
  };
}

// FAUCET không có chữ ký (giống coinbase) — luật "một lần mỗi publicKey" mới là thứ chặn lạm dụng.
export function faucetPayload(tx) {
  return {
    type: 'FAUCET',
    to: tx.to,
    coin: tx.coin,
    nft: tx.nft,
    timestamp: tx.timestamp,
    nonce: tx.nonce,
  };
}

// blockIndex nằm trong payload để coinbase của hai block khác nhau không bao giờ trùng txid.
export function coinbasePayload(tx) {
  return {
    type: 'COINBASE',
    to: tx.to,
    coin: tx.coin,
    blockIndex: tx.blockIndex,
    nonce: tx.nonce,
  };
}

export function payloadOf(tx) {
  if (!tx || typeof tx !== 'object') return null;
  if (tx.type === 'TRANSFER') return transferPayload(tx);
  if (tx.type === 'TRADE') return tradePayload(tx);
  if (tx.type === 'FAUCET') return faucetPayload(tx);
  if (tx.type === 'COINBASE') return coinbasePayload(tx);
  return null;
}

export function payloadString(tx) {
  const payload = payloadOf(tx);
  return payload === null ? null : JSON.stringify(payload);
}

export function txid(tx) {
  const str = payloadString(tx);
  return str === null ? null : sha256Hex(utf8ToBytes(str));
}

export async function hashPayload(tx) {
  const str = payloadString(tx);
  if (str === null) return null;
  return sha256(utf8ToBytes(str));
}

export async function signPayload(tx, privateKeyHex) {
  const digest = await hashPayload(tx);
  // prehash: false vì digest đã là SHA-256 32 byte; để mặc định noble sẽ băm thêm một lần nữa.
  const sig = secp.sign(digest, hexToBytes(String(privateKeyHex).trim().toLowerCase()), {
    prehash: false,
  });
  return bytesToHex(sig);
}

export async function verifySignature(tx, signatureHex, publicKeyHex) {
  try {
    const digest = await hashPayload(tx);
    if (digest === null) return false;
    return secp.verify(
      hexToBytes(String(signatureHex).trim().toLowerCase()),
      digest,
      hexToBytes(String(publicKeyHex).trim().toLowerCase()),
      { prehash: false }
    );
  } catch (e) {
    return false;
  }
}

export function makeNonce() {
  return Math.floor(Math.random() * 1e12).toString(36) + Date.now().toString(36);
}

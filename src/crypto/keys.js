import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import * as secp from '@noble/secp256k1';

// @noble/secp256k1 v3 để trống hashes.sha256 / hashes.hmacSha256; không gán thì sign() throw.
// (v2 dùng etc.hmacSha256Sync — API cũ, không còn tồn tại ở v3.)
// Dùng API đồng bộ vì signAsync/verifyAsync của noble cần WebCrypto subtle, React Native không có.
secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key, msg) => hmac(sha256, key, msg);

export { bytesToHex, hexToBytes, utf8ToBytes, sha256, secp };

const HEX_64 = /^[0-9a-f]{64}$/;

export function sha256Hex(bytes) {
  return bytesToHex(sha256(bytes));
}

export async function generatePrivateKey() {
  return bytesToHex(secp.utils.randomSecretKey());
}

export async function isValidPrivateKey(privateKeyHex) {
  const hex = String(privateKeyHex || '').trim().toLowerCase();
  if (!HEX_64.test(hex)) return false;
  try {
    return secp.utils.isValidSecretKey(hexToBytes(hex));
  } catch (e) {
    return false;
  }
}

export async function derivePublicKey(privateKeyHex) {
  const hex = String(privateKeyHex).trim().toLowerCase();
  return bytesToHex(secp.getPublicKey(hexToBytes(hex), true));
}

export async function deriveAddress(publicKeyHex) {
  const hex = String(publicKeyHex).trim().toLowerCase();
  return '0x' + sha256Hex(hexToBytes(hex)).slice(-40);
}

export async function deriveIdentity(privateKeyHex) {
  const privateKey = String(privateKeyHex).trim().toLowerCase();
  const publicKey = await derivePublicKey(privateKey);
  const address = await deriveAddress(publicKey);
  return { privateKey, publicKey, address };
}

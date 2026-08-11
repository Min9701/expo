import * as Crypto from 'expo-crypto';

import { bytesToHex, hexToBytes, sha256, utf8ToBytes } from './keys';

// CẢNH BÁO: đây là mã hoá GIẢN LƯỢC cho mục đích học.
// Khoá = SHA-256(password + salt), rồi XOR byte-wise với private key.
// XOR một lần với khoá 32 byte trên dữ liệu 32 byte không có xác thực toàn vẹn,
// không có key stretching nên brute-force password rất nhanh.
// Sản phẩm thật BẮT BUỘC dùng AES-GCM + PBKDF2/scrypt (hoặc Argon2) để dẫn xuất khoá.

async function deriveKey(password, saltHex) {
  return sha256(utf8ToBytes(String(password) + saltHex));
}

function xorBytes(data, key) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = data[i] ^ key[i % key.length];
  return out;
}

export async function encryptPrivateKey(privateKeyHex, password) {
  const salt = await Crypto.getRandomBytesAsync(16);
  const saltHex = bytesToHex(salt);
  const key = await deriveKey(password, saltHex);
  const cipher = xorBytes(hexToBytes(String(privateKeyHex).trim().toLowerCase()), key);
  return { salt: saltHex, ciphertext: bytesToHex(cipher) };
}

export async function decryptPrivateKey(ciphertextHex, saltHex, password) {
  const key = await deriveKey(password, saltHex);
  return bytesToHex(xorBytes(hexToBytes(ciphertextHex), key));
}

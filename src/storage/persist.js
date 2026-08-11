import AsyncStorage from '@react-native-async-storage/async-storage';

import { mirrorMany, mirrorOne } from './mirror';

const SCHEMA_KEY = 'schema';
const SCHEMA_VERSION = 'v3';

// v1/v2 lưu chain riêng cho từng ví ('chain:<address>'), có block SYSTEM airdrop và
// difficulty 2 — không tương thích với luật đồng thuận hiện tại (genesis hardcode,
// FAUCET, COINBASE 50 coin, difficulty 3).
// Gặp schema cũ (hoặc chưa có) thì xoá sạch storage rồi bắt đầu lại, tránh crash khi parse.
export async function ensureSchema() {
  let current = null;
  try {
    current = await AsyncStorage.getItem(SCHEMA_KEY);
  } catch (e) {
    current = null;
  }

  if (current === SCHEMA_VERSION) return false;

  try {
    await AsyncStorage.clear();
  } catch (e) {
    // storage rỗng hoặc không xoá được thì vẫn tiếp tục ghi cờ schema
  }
  await AsyncStorage.setItem(SCHEMA_KEY, SCHEMA_VERSION);
  return true;
}

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

async function writeJson(key, value) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
  mirrorOne(key, value);
}

// Day toan bo storage hien co ve may tinh mot lan luc khoi dong, vi mirrorOne chi bat duoc
// nhung lan ghi moi — du lieu luu tu phien truoc se khong xuat hien neu khong co buoc nay.
export async function mirrorSnapshot() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const pairs = await AsyncStorage.multiGet(keys);
    const items = [];
    for (const [key, raw] of pairs) {
      if (key === SCHEMA_KEY) continue;
      try {
        items.push({ key, value: JSON.parse(raw) });
      } catch (e) {
        items.push({ key, value: raw });
      }
    }
    mirrorMany(items);
  } catch (e) {
    // khong co gi de doi chieu thi thoi
  }
}

export function accountKey(username) {
  return 'accounts:' + String(username).trim().toLowerCase();
}

export async function loadAccount(username) {
  return readJson(accountKey(username), null);
}

export async function saveAccount(username, account) {
  await writeJson(accountKey(username), account);
}

// Chain thuộc về MÁY (một full node), không thuộc về từng ví: hai tài khoản đăng nhập
// trên cùng điện thoại vẫn dùng chung một sổ cái, đúng như một node Bitcoin.
const CHAIN_KEY = 'node:chain';
const MEMPOOL_KEY = 'node:mempool';
const ORDERS_KEY = 'node:orders';

export async function loadNodeChain() {
  const chain = await readJson(CHAIN_KEY, null);
  return Array.isArray(chain) ? chain : null;
}

export async function saveNodeChain(chain) {
  await writeJson(CHAIN_KEY, chain);
}

export async function loadNodeMempool() {
  const list = await readJson(MEMPOOL_KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function saveNodeMempool(list) {
  await writeJson(MEMPOOL_KEY, list);
}

export async function loadNodeOrders() {
  const list = await readJson(ORDERS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function saveNodeOrders(list) {
  await writeJson(ORDERS_KEY, list);
}

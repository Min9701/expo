import { useSyncExternalStore } from 'react';

import { RELAY_URL } from '../config';
import { GossipClient } from '../network/gossip';
import {
  loadNodeOrders,
  loadNodeChain,
  loadNodeMempool,
  saveNodeChain,
  saveNodeMempool,
  saveNodeOrders,
} from '../storage/persist';
import { NodeCore } from './NodeCore';

// Node của máy này chỉ có MỘT bản duy nhất, sống độc lập với vòng đời màn hình:
// đổi tab hay mở modal không được làm gián đoạn việc đào hay kết nối relay.

const MAX_LOGS = 40;
const FLUSH_MS = 200;

let core = null;
let client = null;
let connection = 'closed';
let connectionDetail = '';
let logs = [];
let orderAlert = null;

let snapshot = emptySnapshot();
let dirty = false;
let flushTimer = null;
const listeners = new Set();

function emptySnapshot() {
  return {
    ready: false,
    connection: 'closed',
    connectionDetail: '',
    height: 0,
    blocks: 0,
    headHash: '',
    mempoolSize: 0,
    orphanCount: 0,
    mining: false,
    miningStats: { nonce: 0, hashrate: 0, minedByMe: 0 },
    lastReorg: null,
    confirmed: { coins: 0, nfts: 0 },
    pending: { coins: 0, nfts: 0 },
    chain: [],
    orders: [],
    logs: [],
    orderAlert: null,
  };
}

function rebuild() {
  snapshot = core
    ? { ...core.snapshot(), ready: true, connection, connectionDetail, logs, orderAlert }
    : { ...emptySnapshot(), connection, connectionDetail, logs };
  listeners.forEach((listener) => listener());
}

// Lúc đào, NodeCore báo state đổi vài lần mỗi giây. Gom lại rồi mới vẽ để UI không bị dội.
function markDirty(immediate) {
  dirty = true;
  if (immediate) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    dirty = false;
    return rebuild();
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (dirty) {
      dirty = false;
      rebuild();
    }
  }, FLUSH_MS);
}

function onCoreEvent(event) {
  if (event.kind === 'log') {
    logs = [{ ...event }, ...logs].slice(0, MAX_LOGS);
    return markDirty(true);
  }
  if (event.kind === 'order') {
    orderAlert = { order: event.order, at: Date.now() };
    return markDirty(true);
  }
  markDirty(false);
}

export async function startNode(identity) {
  if (core) {
    core.setIdentity(identity);
    markDirty(true);
    return core;
  }

  core = new NodeCore({
    identity,
    send: (msg) => {
      if (client) client.send(msg);
    },
    persistChain: saveNodeChain,
    persistMempool: saveNodeMempool,
    persistOrders: saveNodeOrders,
    onEvent: onCoreEvent,
  });

  const [chain, mempool, orders] = await Promise.all([
    loadNodeChain(),
    loadNodeMempool(),
    loadNodeOrders(),
  ]);
  await core.start({ chain, mempool, orders });

  client = new GossipClient({
    url: RELAY_URL,
    onMessage: (msg) => core.handleMessage(msg),
    onStatus: (status, detail) => {
      connection = status;
      connectionDetail = detail;
      if (status === 'open') {
        core.log('success', 'Đã kết nối relay ' + RELAY_URL);
        // Khoe chiều cao ngay khi vào mạng để bắt kịp phần chain còn thiếu.
        core.sendPingHeight();
      } else if (status === 'reconnecting') {
        core.log('warn', detail);
      }
      markDirty(true);
    },
  });
  client.connect();
  core.startHeartbeat();

  // Chờ một nhịp cho chain đồng bộ trước khi xin FAUCET, tránh xin lần hai vô ích.
  setTimeout(() => {
    if (core) core.requestFaucet();
  }, 3000);

  markDirty(true);
  return core;
}

export function getNode() {
  return core;
}

export function clearOrderAlert() {
  orderAlert = null;
  markDirty(true);
}

export function startMining() {
  if (core) core.startMining();
}

export function stopMining() {
  if (core) core.stopMining();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function useNodeState() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

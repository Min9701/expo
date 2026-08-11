// ============================================================================
//  ĐỔI IP NÀY thành IP LAN của laptop, xem console khi chạy relay
//  (cd relay && npm start  → nó in ra sẵn các URL ws://... để dán vào đây)
//  Điện thoại và laptop phải cùng một mạng Wi-Fi.
//  ĐÂY LÀ CHỖ DUY NHẤT PHẢI SỬA.
// ============================================================================
export const RELAY_URL = 'ws://192.168.42.8:3001';

// --- Luật đồng thuận: mọi node phải dùng y hệt các con số này ---------------
export const DIFFICULTY = 3;
export const POW_PREFIX = '0'.repeat(DIFFICULTY);
export const COINBASE_REWARD = 50;
export const FAUCET_COIN = 100;
export const FAUCET_NFT = 10;

// Genesis dùng timestamp cố định để mọi node có block #0 giống nhau byte-for-byte.
export const GENESIS_TIMESTAMP = 1735689600000;

// --- Tham số vận hành ------------------------------------------------------
// Số nonce thử mỗi lượt trước khi nhả luồng cho UI. Lớn hơn = đào nhanh hơn nhưng UI giật.
export const MINE_BATCH = 500;
export const PING_INTERVAL_MS = 10000;
export const RECONNECT_MIN_MS = 3000;
export const RECONNECT_MAX_MS = 15000;
// Khi phát hiện chain lạ, xin lại từ vài block trước head để bắt được cả fork sâu.
export const GET_CHAIN_LOOKBACK = 6;
export const CONFIRMATIONS_SAFE = 2;

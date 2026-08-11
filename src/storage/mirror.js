import { NativeModules } from 'react-native';

// Cong cu HOC TAP: gui ban sao moi lan ghi AsyncStorage ve may tinh de xem duoc so cai
// duoi dang file (xem tools/ledger-mirror.mjs). Khong anh huong logic blockchain:
// moi loi mang deu bi nuot, khong await, chi chay khi __DEV__.

const PORT = 8790;
const TIMEOUT_MS = 1500;

// De trong thi tu do IP may tinh tu URL bundle cua Metro. Dien tay neu dung che do tunnel.
const MANUAL_HOST = '';

let cached;

function host() {
  if (cached !== undefined) return cached;
  if (MANUAL_HOST) {
    cached = MANUAL_HOST;
    return cached;
  }
  try {
    const sc = NativeModules.SourceCode;
    const url =
      (sc && (sc.scriptURL || (sc.getConstants && sc.getConstants().scriptURL))) || '';
    const match = /^https?:\/\/([^/:]+)/.exec(url);
    cached = match && !/exp\.direct$/.test(match[1]) ? match[1] : null;
  } catch (e) {
    cached = null;
  }
  return cached;
}

// Duoc goi ngay trong duong ghi cua persist.js nen tuyet doi khong duoc nem loi:
// server khong chay, khong co mang, thieu AbortController... deu phai im lang bo qua.
function send(payload) {
  try {
    if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
    const h = host();
    if (!h) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    fetch('http://' + h + ':' + PORT + '/mirror', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .catch(() => {})
      .then(() => clearTimeout(timer), () => clearTimeout(timer));
  } catch (e) {
    // khong lam gi
  }
}

export function mirrorOne(key, value) {
  send({ key, value });
}

export function mirrorMany(items) {
  if (items.length) send(items);
}

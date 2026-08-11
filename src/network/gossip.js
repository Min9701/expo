import { RECONNECT_MAX_MS, RECONNECT_MIN_MS } from '../config.js';

// Đường truyền tới relay câm. Chỉ làm ba việc: mở kết nối, gửi JSON, nhận JSON.
// Không hiểu nội dung gói tin — mọi luật lệ nằm ở NodeCore.
// Dùng global WebSocket: React Native có sẵn, Node 22+ cũng có sẵn (dùng cho script test).
export class GossipClient {
  constructor({ url, onMessage, onStatus }) {
    this.url = url;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.socket = null;
    this.status = 'closed';
    this.delay = RECONNECT_MIN_MS;
    this.timer = null;
    this.stopped = false;
  }

  setStatus(status, detail) {
    this.status = status;
    this.onStatus(status, detail || '');
  }

  connect() {
    this.stopped = false;
    if (this.socket) return;

    this.setStatus('connecting');
    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch (e) {
      return this.scheduleReconnect('Không mở được WebSocket: ' + String(e.message || e));
    }
    this.socket = socket;

    socket.onopen = () => {
      this.delay = RECONNECT_MIN_MS;
      this.setStatus('open');
    };

    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch (e) {
        return;
      }
      this.onMessage(msg);
    };

    socket.onerror = () => {
      // onclose luôn chạy sau onerror; để onclose lo việc kết nối lại.
    };

    socket.onclose = () => {
      this.socket = null;
      this.scheduleReconnect('Mất kết nối tới relay');
    };
  }

  // Backoff 3s → tối đa 15s, tránh dội liên tục khi laptop chưa bật relay.
  scheduleReconnect(detail) {
    this.socket = null;
    if (this.stopped) return this.setStatus('closed', detail);

    this.setStatus('reconnecting', detail + ' — thử lại sau ' + Math.round(this.delay / 1000) + 's');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, RECONNECT_MAX_MS);
  }

  send(obj) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch (e) {
        // đang đóng dở thì thôi
      }
    }
    this.setStatus('closed');
  }
}

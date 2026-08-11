// RELAY CÂM — chỉ là đường truyền mạng giữa các node.
// KHÔNG giữ chain, KHÔNG verify chữ ký, KHÔNG đào, KHÔNG quyết định chain nào đúng.
// State duy nhất: danh sách kết nối đang mở (do WebSocketServer tự giữ).
// Nếu bạn định thêm logic nghiệp vụ vào file này thì bạn đang làm sai chỗ.

const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = 3001;

function lanUrls() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push({ name, url: 'ws://' + net.address + ':' + PORT });
    }
  }
  return out;
}

function stamp() {
  return new Date().toLocaleTimeString('vi-VN', { hour12: false });
}

// Chỉ đọc trường `type` để in log cho dễ theo dõi. Nội dung gói không bị thay đổi.
function peekType(raw) {
  try {
    const t = JSON.parse(raw).type;
    return typeof t === 'string' ? t : '?';
  } catch (e) {
    return 'non-json';
  }
}

const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT });

wss.on('listening', () => {
  console.log('[' + stamp() + '] Relay câm đang lắng nghe 0.0.0.0:' + PORT);
  const urls = lanUrls();
  if (urls.length === 0) {
    console.log('  Không tìm thấy IPv4 LAN nào — kiểm tra kết nối Wi-Fi.');
  } else {
    console.log('  Dán MỘT trong các URL này vào RELAY_URL trong src/config.js:');
    for (const item of urls) console.log('    ' + item.url + '   (' + item.name + ')');
  }
  console.log('  Điện thoại và laptop phải cùng một mạng Wi-Fi.');
});

let seq = 0;

wss.on('connection', (socket, req) => {
  const id = ++seq;
  const peer = (req.socket.remoteAddress || '?').replace('::ffff:', '');
  socket.peerLabel = '#' + id + ' ' + peer;
  console.log('[' + stamp() + '] + kết nối ' + socket.peerLabel + ' (tổng ' + wss.clients.size + ')');

  socket.on('message', (data, isBinary) => {
    const raw = isBinary ? data : data.toString();
    let sent = 0;
    for (const client of wss.clients) {
      // Không gửi ngược về người gửi.
      if (client === socket || client.readyState !== 1) continue;
      client.send(raw, { binary: isBinary });
      sent += 1;
    }
    console.log(
      '[' + stamp() + '] ' + socket.peerLabel + ' → ' + peekType(raw) +
        ' (' + raw.length + ' byte) chuyển tới ' + sent + ' client'
    );
  });

  socket.on('close', () => {
    console.log('[' + stamp() + '] - ngắt ' + socket.peerLabel + ' (còn ' + (wss.clients.size - 1) + ')');
  });

  socket.on('error', (err) => {
    console.log('[' + stamp() + '] ! lỗi socket ' + socket.peerLabel + ': ' + err.message);
  });
});

wss.on('error', (err) => {
  console.log('[' + stamp() + '] ! lỗi server: ' + err.message);
  if (err.code === 'EADDRINUSE') console.log('  Cổng ' + PORT + ' đang bị chiếm — tắt tiến trình relay cũ rồi chạy lại.');
});

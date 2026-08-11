// Server phu tro cho viec HOC: nhan ban sao AsyncStorage tu dien thoai va ghi ra file
// trong thu muc ledgers/ de xem duoc so cai cua tung tai khoan tren may tinh.
// Khong lien quan gi toi logic blockchain. Chi chay khi dev: npm run mirror

import { createServer } from 'node:http';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const PORT = 8790;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'ledgers');

mkdirSync(OUT, { recursive: true });

// Key den tu thiet bi nen phai lam sach truoc khi dung lam ten file (chan path traversal).
function safeName(key) {
  return String(key).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
}

function shortHash(h) {
  const s = String(h || '');
  return s.length > 16 ? s.slice(0, 10) + '…' + s.slice(-6) : s;
}

function describeTx(tx) {
  if (tx.type === 'COINBASE') return `COINBASE +${tx.coin} coin -> ${shortHash(tx.to)}`;
  if (tx.type === 'FAUCET') return `FAUCET +${tx.coin} coin +${tx.nft} NFT -> ${shortHash(tx.to)}`;
  if (tx.type === 'TRANSFER') return `TRANSFER ${tx.amount} coin ${shortHash(tx.from)} -> ${shortHash(tx.to)}`;
  if (tx.type === 'TRADE') return `TRADE ${tx.nftCount} NFT <-> ${tx.coinAmount} coin`;
  return String(tx.type);
}

function summarizeChain(name, chain) {
  const lines = [];
  lines.push(`SO CAI  ${name}`);
  lines.push(`  so block : ${chain.length}`);
  lines.push(`  tip      : ${chain.length ? chain[chain.length - 1].hash : '(rong)'}`);
  for (const b of chain) {
    const txs = b.transactions || [];
    const head = `  #${String(b.index).padEnd(3)} ${shortHash(b.hash)}  prev ${shortHash(b.previousHash)}  nonce ${b.nonce}`;
    lines.push(head);
    if (txs.length === 0) lines.push('        (khong co giao dich)');
    for (const tx of txs) lines.push('        ' + describeTx(tx));
  }
  return lines.join('\n');
}

function rebuildSummary() {
  const files = readdirSync(OUT).filter((f) => f.endsWith('.json'));
  const chains = [];
  const others = [];

  for (const f of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
    } catch {
      continue;
    }
    // Chain gio thuoc ve MAY (key 'node:chain'), khong con moi vi mot ban rieng.
    if (f.startsWith('node-chain') && Array.isArray(data)) chains.push([f, data]);
    else others.push([f, data]);
  }

  const out = [];
  out.push('TONG QUAN SO CAI — sinh tu doi chieu AsyncStorage cua thiet bi');
  out.push('cap nhat luc ' + new Date().toLocaleString('vi-VN'));
  out.push('');
  out.push(`So node (tai khoan co so cai rieng): ${chains.length}`);
  out.push('');

  if (chains.length >= 2) {
    out.push('--- DOI CHIEU GIUA CAC NODE ---');
    for (const [f, c] of chains) {
      out.push(`  ${f.padEnd(56)} ${String(c.length).padStart(3)} block  tip ${shortHash(c[c.length - 1]?.hash)}`);
    }
    const tips = new Set(chains.map(([, c]) => c[c.length - 1]?.hash));
    out.push(tips.size === 1 ? '  => cac node DANG HOI TU (cung tip)' : '  => cac node DANG LECH NHAU (khac tip)');
    out.push('');
  }

  for (const [f, c] of chains) {
    out.push('--------------------------------------------------------------');
    out.push(summarizeChain(f, c));
    out.push('');
  }

  if (others.length) {
    out.push('--------------------------------------------------------------');
    out.push('CAC KEY KHAC (khong phai so cai)');
    for (const [f, d] of others) {
      const n = Array.isArray(d) ? `${d.length} phan tu` : typeof d;
      out.push(`  ${f.padEnd(56)} ${n}`);
    }
  }

  writeFileSync(join(OUT, '_tong-quan.txt'), out.join('\n'), 'utf8');
}

function handleMirror(payload) {
  const items = Array.isArray(payload) ? payload : [payload];
  const written = [];
  for (const item of items) {
    if (!item || typeof item.key !== 'string') continue;
    const file = safeName(item.key) + '.json';
    writeFileSync(join(OUT, file), JSON.stringify(item.value, null, 2), 'utf8');
    written.push(file);
  }
  if (written.length) {
    rebuildSummary();
    console.log(new Date().toLocaleTimeString('vi-VN') + '  ghi  ' + written.join(', '));
  }
  return written;
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (req.method === 'GET' && req.url === '/ping') {
    return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  }

  if (req.method !== 'POST' || req.url !== '/mirror') {
    return res.writeHead(404).end('not found');
  }

  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 20e6) req.destroy();
  });
  req.on('end', () => {
    try {
      const written = handleMirror(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ written }));
    } catch (e) {
      console.error('loi:', e.message);
      res.writeHead(400).end('bad json');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('Ledger mirror dang chay tren cong ' + PORT);
  console.log('Thu muc xuat: ' + OUT);
  console.log('Dien thoai se tu tim thay qua: ' + ips.map((i) => `http://${i}:${PORT}`).join(', '));
  console.log('Dang cho app ghi du lieu...\n');
  rebuildSummary();
});

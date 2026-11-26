import 'dotenv/config';
import express from 'express';
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
  downloadContentFromMessage, jidNormalizedUser
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const API_TOKEN = process.env.API_TOKEN || '';
const DASHBOARD_ORIGIN = 'https://zoraww.vercel.app';
const DATA_DIR = path.resolve('data');
const AUTH_DIR = path.resolve('auth_info');
const TMP_DIR = path.resolve('tmp');
for (const dir of [DATA_DIR, AUTH_DIR, TMP_DIR]) fs.mkdirSync(dir, { recursive: true });

if (!DASHBOARD_PASSWORD || DASHBOARD_PASSWORD.length < 16) {
  console.error('Set DASHBOARD_PASSWORD to a random value of at least 16 characters in .env');
  process.exit(1);
}
if (!API_TOKEN || API_TOKEN.length < 32) {
  console.error('Set API_TOKEN to a random value of at least 32 characters in .env');
  process.exit(1);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === DASHBOARD_ORIGIN || origin === 'http://localhost:3000') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Bypass-Tunnel-Reminder');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const header = req.headers.authorization || '';
  if (req.path.startsWith('/api/')) {
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token !== API_TOKEN) return res.status(401).json({ error: 'API token tidak valid.' });
    return next();
  }
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.setHeader('WWW-Authenticate', 'Basic realm="ZORAWW Dashboard"');
    return res.status(401).send('Login dashboard diperlukan.');
  }
  let decoded = '';
  try { decoded = Buffer.from(encoded, 'base64').toString('utf8'); } catch {}
  const supplied = decoded.slice(decoded.indexOf(':') + 1);
  if (decoded.indexOf(':') < 0 || supplied !== DASHBOARD_PASSWORD) return res.status(401).send('Password salah.');
  next();
});
app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true }));

let sock;
let connected = false;
let pairingBusy = false;
let latestPairCode = '';
let logs = [];
let groupSettings = readJson('groups.json', {});
let stats = readJson('stats.json', { messages: 0, commands: 0, startedAt: new Date().toISOString() });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); } catch { return fallback; }
}
function saveJson(file, value) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value, null, 2));
}
function log(message) {
  const line = new Date().toISOString() + ' ' + message;
  logs.unshift(line);
  logs = logs.slice(0, 100);
  console.log(line);
}
function setting(group) {
  return groupSettings[group] ||= { welcome: false, antilink: false, antispam: false };
}
function getText(msg) {
  const m = msg.message || {};
  return m.conversation || m.extendedTextMessage?.text ||
    m.imageMessage?.caption || m.videoMessage?.caption ||
    m.documentMessage?.caption || '';
}
function unwrapMessage(message) {
  let m = message;
  while (m?.ephemeralMessage || m?.viewOnceMessage || m?.viewOnceMessageV2) {
    m = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message;
  }
  return m || {};
}
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function downloadMedia(message, type) {
  const stream = await downloadContentFromMessage(message, type);
  return streamToBuffer(stream);
}
async function isGroupAdmin(group, participant) {
  try {
    const meta = await sock.groupMetadata(group);
    const item = meta.participants.find(p => jidNormalizedUser(p.id) === jidNormalizedUser(participant));
    return Boolean(item?.admin);
  } catch { return false; }
}
async function sendText(jid, text, quoted) {
  return sock.sendMessage(jid, { text }, quoted ? { quoted } : {});
}

async function handleMessage(msg) {
  if (!msg.message || msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;
  const isGroup = jid.endsWith('@g.us');
  const sender = isGroup ? (msg.key.participant || msg.participant || '') : jid;
  const body = getText({ ...msg, message: unwrapMessage(msg.message) }).trim();
  stats.messages++;
  if (stats.messages % 10 === 0) saveJson('stats.json', stats);
  if (!body) return;
  const parts = body.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  const cfg = isGroup ? setting(jid) : {};

  if (isGroup && cfg.antilink && /(https?:\/\/|www\.|chat\.whatsapp\.com\/)/i.test(body)) {
    const admin = await isGroupAdmin(jid, sender);
    if (!admin) {
      await sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
      await sendText(jid, 'Tautan terdeteksi. Pesan dihapus oleh ZORAWW.', msg);
      return;
    }
  }

  if (isGroup && cfg.antispam) {
    const now = Date.now();
    const key = jid + ':' + sender;
    spamMap[key] = (spamMap[key] || []).filter(t => now - t < 7000);
    spamMap[key].push(now);
    if (spamMap[key].length > 6) {
      if (!(await isGroupAdmin(jid, sender))) {
        await sendText(jid, 'Terlalu banyak pesan dalam waktu singkat. Istirahat sebentar ya.', msg);
        return;
      }
    }
  }

  if (!command.startsWith('.')) return;
  stats.commands++;
  saveJson('stats.json', stats);
  const reply = text => sendText(jid, text, msg);
  const groupOnly = () => isGroup ? true : (reply('Perintah ini hanya untuk grup.'), false);
  const adminOnly = async () => {
    if (!isGroup) { await reply('Perintah ini hanya untuk grup.'); return false; }
    if (!(await isGroupAdmin(jid, sender))) { await reply('Khusus admin grup.'); return false; }
    return true;
  };

  try {
    switch (command) {
      case '.menu':
        return reply('ZORAWW BOT\n\nUMUM\n.ping - cek bot\n.menu - daftar perintah\n.infogc - info grup\n.cekid - ID chat\n\nADMIN GRUP\n.tagall - tag anggota\n.hidetag teks - tag tanpa daftar nama\n.kick @user\n.promote @user\n.demote @user\n.open / .close\n.resetlink\n.welcome on/off\n.antilink on/off\n.antispam on/off\n\nMEDIA\n.sticker / .s - foto/video jadi stiker\n.toimg - stiker jadi gambar\n.tomp3 - audio/video jadi MP3\n.stcaudio - audio/video jadi voice note (maks 30 detik)\n\nCatatan: sticker WhatsApp standar tidak bisa memuat audio. .stcaudio mengirim voice note terpisah.');
      case '.ping':
        return reply('Pong! ZORAWW aktif.');
      case '.cekid':
        return reply('Chat ID: ' + jid + '\nPengirim: ' + sender);
      case '.infogc': {
        if (!groupOnly()) return;
        const meta = await sock.groupMetadata(jid);
        return reply('Nama: ' + meta.subject + '\nAnggota: ' + meta.participants.length + '\nID: ' + jid);
      }
      case '.listadmin': {
        if (!groupOnly()) return;
        const meta = await sock.groupMetadata(jid);
        const admins = meta.participants.filter(p => p.admin).map(p => '• @' + p.id.split('@')[0]);
        return sock.sendMessage(jid, { text: 'Admin grup:\n' + (admins.join('\n') || 'Tidak ada'), mentions: meta.participants.filter(p => p.admin).map(p => p.id) });
      }
      case '.tagall': {
        if (!(await adminOnly())) return;
        const meta = await sock.groupMetadata(jid);
        const mentions = meta.participants.map(p => p.id);
        return sock.sendMessage(jid, { text: 'Panggilan anggota grup:\n' + mentions.map(x => '• @' + x.split('@')[0]).join('\n'), mentions });
      }
      case '.hidetag': {
        if (!(await adminOnly())) return;
        const meta = await sock.groupMetadata(jid);
        return sock.sendMessage(jid, { text: args.join(' ') || ' ', mentions: meta.participants.map(p => p.id) });
      }
      case '.welcome':
      case '.antilink':
      case '.antispam': {
        if (!(await adminOnly())) return;
        const key = command.slice(1);
        const value = (args[0] || '').toLowerCase();
        if (!['on', 'off'].includes(value)) return reply('Gunakan ' + command + ' on atau ' + command + ' off');
        setting(jid)[key] = value === 'on';
        saveJson('groups.json', groupSettings);
        return reply(key + ' ' + value.toUpperCase());
      }
      case '.open':
      case '.close':
        if (!(await adminOnly())) return;
        await sock.groupSettingUpdate(jid, command === '.open' ? 'not_announcement' : 'announcement');
        return reply(command === '.open' ? 'Grup dibuka.' : 'Grup ditutup untuk anggota.');
      case '.resetlink':
        if (!(await adminOnly())) return;
        await sock.groupRevokeInvite(jid);
        return reply('Link undangan grup berhasil diperbarui.');
      case '.kick':
      case '.promote':
      case '.demote': {
        if (!(await adminOnly())) return;
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (!mentioned.length) return reply('Tag anggota yang dimaksud.');
        const action = command === '.kick' ? 'remove' : command === '.promote' ? 'promote' : 'demote';
        await sock.groupParticipantsUpdate(jid, mentioned, action);
        return reply('Perintah ' + action + ' diproses.');
      }
      case '.sticker':
      case '.s': {
        const m = unwrapMessage(msg.message);
        const image = m.imageMessage;
        const video = m.videoMessage;
        const quoted = m.extendedTextMessage?.contextInfo?.quotedMessage;
        const source = image || video || quoted?.imageMessage || quoted?.videoMessage;
        if (!source) return reply('Kirim/balas foto atau video pendek dengan caption .sticker');
        const type = source.mimetype?.startsWith('video/') ? 'video' : 'image';
        const input = path.join(TMP_DIR, Date.now() + (type === 'video' ? '.mp4' : '.jpg'));
        const output = input + '.webp';
        fs.writeFileSync(input, await downloadMedia(source, type));
        try {
          await execFileAsync('ffmpeg', ['-y', '-i', input, '-vframes', '1', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000', '-vcodec', 'libwebp', output]);
          await sock.sendMessage(jid, { sticker: fs.readFileSync(output) }, { quoted: msg });
        } finally { fs.rmSync(input, { force: true }); fs.rmSync(output, { force: true }); }
        return;
      }
      case '.toimg': {
        const quoted = unwrapMessage(msg.message).extendedTextMessage?.contextInfo?.quotedMessage;
        const sticker = quoted?.stickerMessage;
        if (!sticker) return reply('Balas sebuah stiker dengan .toimg');
        const input = path.join(TMP_DIR, Date.now() + '.webp');
        const output = input + '.png';
        fs.writeFileSync(input, await downloadMedia(sticker, 'sticker'));
        try {
          await execFileAsync('ffmpeg', ['-y', '-i', input, output]);
          await sock.sendMessage(jid, { image: fs.readFileSync(output), caption: 'Hasil konversi stiker.' }, { quoted: msg });
        } finally { fs.rmSync(input, { force: true }); fs.rmSync(output, { force: true }); }
        return;
      }
      case '.tomp3': {
        const m = unwrapMessage(msg.message);
        const quoted = m.extendedTextMessage?.contextInfo?.quotedMessage;
        const source = m.audioMessage || m.videoMessage || quoted?.audioMessage || quoted?.videoMessage;
        if (!source) return reply('Kirim/balas audio atau video dengan caption .tomp3');
        const type = source.mimetype?.startsWith('video/') ? 'video' : 'audio';
        const input = path.join(TMP_DIR, Date.now() + (type === 'video' ? '.mp4' : '.bin'));
        const output = input + '.mp3';
        fs.writeFileSync(input, await downloadMedia(source, type));
        try {
          await execFileAsync('ffmpeg', ['-y', '-i', input, '-vn', '-codec:a', 'libmp3lame', '-q:a', '4', output]);
          await sock.sendMessage(jid, { audio: fs.readFileSync(output), mimetype: 'audio/mpeg', fileName: 'zora-audio.mp3' }, { quoted: msg });
        } finally { fs.rmSync(input, { force: true }); fs.rmSync(output, { force: true }); }
        return;
      }
      case '.stcaudio': {
        const m = unwrapMessage(msg.message);
        const quoted = m.extendedTextMessage?.contextInfo?.quotedMessage;
        const source = m.audioMessage || m.videoMessage || quoted?.audioMessage || quoted?.videoMessage;
        if (!source) return reply('Kirim atau balas audio/video lalu ketik .stcaudio');
        const type = source.mimetype?.startsWith('video/') ? 'video' : 'audio';
        const input = path.join(TMP_DIR, Date.now() + (type === 'video' ? '.mp4' : '.bin'));
        const output = input + '.ogg';
        fs.writeFileSync(input, await downloadMedia(source, type));
        try {
          await execFileAsync('ffmpeg', ['-y', '-i', input, '-t', '30', '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', output]);
          await sock.sendMessage(jid, { audio: fs.readFileSync(output), mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
        } finally { fs.rmSync(input, { force: true }); fs.rmSync(output, { force: true }); }
        return;
      }
      default:
        return;
    }
  } catch (error) {
    log('Command error: ' + error.message);
    return reply('Perintah gagal diproses. Cek log dashboard.');
  }
}

const spamMap = {};
let reconnecting = false;
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, browser: ['ZORAWW', 'Chrome', '1.0.0'] });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') { connected = true; pairingBusy = false; latestPairCode = ''; log('WhatsApp connected.'); }
    if (connection === 'close') {
      connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      log('WhatsApp disconnected: ' + code);
      if (code !== DisconnectReason.loggedOut && !reconnecting) {
        reconnecting = true;
        setTimeout(() => startBot().finally(() => { reconnecting = false; }), 3000);
      } else if (code === DisconnectReason.loggedOut) log('Session logout. Hapus auth_info setelah memastikan ingin pairing ulang.');
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) await handleMessage(msg);
  });
  sock.ev.on('group-participants.update', async update => {
    try {
      if (update.action !== 'add' || !setting(update.id).welcome || !connected) return;
      const meta = await sock.groupMetadata(update.id);
      const mentions = update.participants || [];
      if (!mentions.length) return;
      await sock.sendMessage(update.id, {
        text: 'Selamat datang di *' + meta.subject + '*!\nSilakan baca deskripsi dan aturan grup ya.',
        mentions
      });
    } catch (error) {
      log('Welcome event error: ' + error.message);
    }
  });
}

app.get('/api/status', (_req, res) => res.json({ connected, pairingBusy, pairCode: latestPairCode, stats, memory: Math.round(process.memoryUsage().rss / 1024 / 1024), uptime: Math.floor(process.uptime()) }));
app.get('/api/logs', (_req, res) => res.json({ logs }));
app.post('/api/pair', async (req, res) => {
  const number = String(req.body?.number || '').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(number)) return res.status(400).json({ error: 'Masukkan nomor internasional tanpa tanda +, 10-15 digit.' });
  if (connected) return res.status(409).json({ error: 'Bot sudah terhubung.' });
  if (pairingBusy) return res.status(409).json({ error: 'Permintaan pairing sedang diproses.' });
  try {
    pairingBusy = true;
    if (!sock) await startBot();
    const code = await sock.requestPairingCode(number);
    latestPairCode = String(code).match(/.{1,4}/g)?.join('-') || String(code);
    log('Pairing code dibuat untuk nomor berakhiran ' + number.slice(-4));
    res.json({ code: latestPairCode, label: 'ZORAXBOT' });
  } catch (error) {
    pairingBusy = false;
    log('Pairing error: ' + error.message);
    res.status(500).json({ error: 'Gagal membuat pairing code. Coba lagi setelah beberapa saat.' });
  }
});
app.get('/api/groups', async (_req, res) => {
  if (!connected) return res.json({ groups: [] });
  try {
    const groups = await sock.groupFetchAllParticipating();
    res.json({ groups: Object.values(groups).map(g => ({ id: g.id, subject: g.subject, participants: g.participants.length, settings: setting(g.id) })) });
  } catch { res.status(500).json({ error: 'Gagal mengambil daftar grup.' }); }
});
app.post('/api/groups/:id/settings', (req, res) => {
  const id = req.params.id;
  const allowed = ['welcome', 'antilink', 'antispam'];
  const key = req.body?.key;
  if (!allowed.includes(key) || typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Pengaturan tidak valid.' });
  setting(id)[key] = req.body.enabled;
  saveJson('groups.json', groupSettings);
  res.json({ ok: true, settings: setting(id) });
});
app.get('/api/health-details', (_req, res) => res.json({ hostname: os.hostname(), node: process.version, platform: process.platform }));

app.listen(PORT, '0.0.0.0', () => log('Dashboard berjalan pada port ' + PORT));
startBot().catch(error => log('Bot startup error: ' + error.message));

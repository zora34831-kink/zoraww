#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
echo "== ZORAWW updater =="

git pull --ff-only origin main
npm install

node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';

const file = '.env';
let env = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const setIfMissing = (key, value) => {
  const re = new RegExp('^' + key + '=', 'm');
  if (!re.test(env)) env += (env && !env.endsWith('\n') ? '\n' : '') + key + '=' + value + '\n';
};
setIfMissing('PORT', '3000');
setIfMissing('PREFIX', '.');
setIfMissing('DASHBOARD_PASSWORD', crypto.randomBytes(24).toString('base64url'));
setIfMissing('API_TOKEN', crypto.randomBytes(32).toString('hex'));
fs.writeFileSync(file, env, { mode: 0o600 });
console.log('Konfigurasi lokal diperiksa. Rahasia disimpan di .env dan tidak ditampilkan.');
NODE

echo
echo "Memulai bot dan tunnel. Jangan tutup sesi Termux ini."
echo "Alamat HTTPS tunnel akan muncul di bawah."
npm start > bot.log 2>&1 &
BOT_PID=$!
cleanup() {
  kill "$BOT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
sleep 5
if ! kill -0 "$BOT_PID" 2>/dev/null; then
  echo "Bot gagal mulai. Periksa log dengan: cat bot.log"
  cat bot.log
  exit 1
fi
npm run tunnel

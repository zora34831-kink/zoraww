# ZORAWW

WhatsApp group bot Node.js + Baileys dengan dashboard web.

## Fitur
- Dashboard status bot, statistik, log, pairing code, dan daftar grup.
- Perintah: `.menu`, `.ping`, `.cekid`, `.infogc`, `.listadmin`, `.tagall`, `.hidetag`, `.kick`, `.promote`, `.demote`, `.open`, `.close`, `.resetlink`.
- Pengaturan grup: `.welcome on/off`, `.antilink on/off`, `.antispam on/off`.
- Media: `.sticker` / `.s`, `.toimg`, `.tomp3`, `.stcaudio` (maksimal 30 detik).

Catatan: sticker WhatsApp standar tidak mendukung audio yang bisa diputar. `.stcaudio` mengirim voice note terpisah. Baileys merupakan library tidak resmi; gunakan dengan memahami risiko pembatasan akun dan aturan WhatsApp.

## Jalankan di Termux (Android)
1. Pasang Node.js, Git, dan FFmpeg:
   ```bash
   pkg update -y && pkg upgrade -y
   pkg install nodejs-lts git ffmpeg -y
   ```
2. Clone repo (atau masuk ke folder repo yang sudah ada):
   ```bash
   git clone https://github.com/zora34831-kink/zoraww.git
   cd zoraww
   npm install
   ```
3. Buat file rahasia `.env` di Termux. Jangan kirim file ini ke siapa pun:
   ```bash
   cat > .env <<'EOF'
   PORT=3000
   PREFIX=.
   DASHBOARD_PASSWORD=GANTI_PASSWORD_ACAK_MINIMAL_16_KARAKTER
   API_TOKEN=GANTI_TOKEN_ACAK_MINIMAL_32_KARAKTER
   EOF
   ```
   Ganti kedua nilai contoh dengan rahasia acak milik sendiri. Jangan commit `.env` ke GitHub.
4. Jalankan bot:
   ```bash
   npm start
   ```
   Biarkan proses ini tetap berjalan. Cek lokal dari tab Termux kedua dengan `curl http://127.0.0.1:3000/health`.

## Sambungkan dashboard Vercel ke Termux
1. Pastikan bot/server aktif pada port 3000.
2. Di tab Termux kedua, jalankan:
   ```bash
   cd zoraww
   npm run tunnel
   ```
3. Localtunnel akan menampilkan alamat HTTPS publik. Masukkan alamat itu di bagian **Koneksi server bot** pada dashboard `https://zoraww.vercel.app`.
4. Masukkan nilai `API_TOKEN` yang ada di file `.env`, lalu tekan **Simpan koneksi**.

Alamat tunnel gratis dapat berubah saat tunnel dimulai ulang. Jika berubah, masukkan alamat terbaru pada dashboard. Jangan bagikan URL tunnel dan API token secara publik. API dilindungi Bearer Token dan menerima permintaan browser dari domain dashboard resmi.

## Vercel
Untuk frontend statis, atur:
- Framework Preset: Other
- Root Directory: .
- Build Command: kosong
- Output Directory: public
- Install Command: kosong

Vercel hanya meng-host dashboard statis. Bot Baileys harus tetap berjalan pada Termux/perangkat atau server yang selalu aktif.

## Keamanan dan sesi
- `DASHBOARD_PASSWORD` melindungi halaman dashboard lokal.
- `API_TOKEN` mengamankan API yang diakses dashboard Vercel.
- Jangan unggah `.env`, `auth_info/`, `data/`, atau pairing code ke GitHub.
- Folder `auth_info/` berisi sesi WhatsApp. Jangan hapus jika ingin mempertahankan sesi yang sudah tertaut.
- Tutup akses tunnel jika sudah tidak digunakan. Untuk aktif 24 jam, Android harus tetap menyala, tersambung internet, dan tidak membatasi Termux di latar belakang.

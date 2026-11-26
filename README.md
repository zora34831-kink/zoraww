# ZORAWW

WhatsApp group bot berbasis Node.js, Baileys, dan dashboard web.

## Fitur saat ini
- Dashboard status bot, statistik, log, pairing WhatsApp, dan daftar grup.
- Perintah grup: `.menu`, `.ping`, `.cekid`, `.infogc`, `.listadmin`, `.tagall`, `.hidetag`, `.kick`, `.promote`, `.demote`, `.open`, `.close`, `.resetlink`.
- Moderasi per grup: `.welcome on/off`, `.antilink on/off`, `.antispam on/off`.
- Media: `.sticker`/`.s` untuk foto atau video, `.toimg` untuk mengubah sticker menjadi gambar, `.tomp3` untuk audio/video menjadi MP3, `.stcaudio` untuk mengubah audio/video menjadi voice note maksimal 30 detik.

Catatan: sticker WhatsApp standar tidak mendukung audio yang bisa diputar. `.stcaudio` mengirim voice note terpisah, bukan sticker bersuara. Baileys adalah library tidak resmi dan penggunaan dapat berisiko pembatasan akun.

## Persyaratan
Ubuntu VPS, Node.js 20+, FFmpeg.

## Instalasi
```bash
sudo apt update && sudo apt install -y ffmpeg
npm install
cp .env.example .env
nano .env
npm start
```
Isi `DASHBOARD_PASSWORD` dengan password acak minimal 16 karakter. Dashboard menggunakan HTTP Basic Auth; username bebas, password sesuai `.env`. Untuk akses internet, wajib pasang HTTPS reverse proxy dan firewall. Jangan unggah `.env`, `auth_info/`, `data/`, atau sesi WhatsApp ke GitHub.

## Catatan
- Folder `auth_info/` berisi sesi WhatsApp pribadi. Backup dengan aman.
- Jangan bagikan pairing code atau password dashboard.
- Gunakan bot hanya di grup yang mengizinkan otomatisasi dan hormati aturan WhatsApp.

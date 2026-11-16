# Cuan!

Aplikasi catatan keuangan pribadi yang konyol tapi rapi, ditemani maskot Si Cuan.

- **Tampilan (PWA):** `index.html`, di-host di GitHub Pages. Bisa dipasang di layar utama HP.
- **Server:** `apps-script/Code.gs`, berjalan di Google Apps Script dan menyimpan data ke Google Sheets.
- **Keamanan:** setiap permintaan butuh token dari PIN 4–6 angka. PIN disimpan sebagai hash di Script Properties, dan dikunci 15 menit setelah 5 kali salah.

## Update kode server

1. Salin isi `apps-script/Code.gs` ke editor Apps Script proyek **Cuan!**, lalu simpan.
2. Deploy → Manage deployments → ikon pensil → Version: **New version** → Deploy.

Lupa PIN? Jalankan fungsi `resetPin` dari editor Apps Script, lalu buat PIN baru di aplikasi.

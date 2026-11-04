# Sanz Water — paket Vercel

Folder **SansWater** berisi aplikasi React/Vite dan API Node.js 24 untuk Vercel Functions. GitHub menyimpan kode; Supabase tetap menjadi database utama; foto tetap privat di GAS/Google Drive. Login tetap memakai username/kata sandi yang sudah ada.

Mulai dari **[DEPLOY-VERCEL.md](DEPLOY-VERCEL.md)**. Hasil pemeriksaan, arsitektur dan batas penggunaan ada di **[VERIFIKASI.md](VERIFIKASI.md)**.

## Isi folder

- `src/`: tampilan dan alur kerja aplikasi; tema yang disetujui dipertahankan.
- `public/`: aset publik aplikasi.
- `api/index.js`: satu pintu masuk Vercel Functions untuk seluruh `/api/*`.
- `server/`: autentikasi, izin, transaksi, laporan, sinkronisasi dan penghubung Supabase/GAS.
- `scripts/`: backup lokal dan alat admin data.
- `vercel.json`: build Vite, routing API, header keamanan, region dan durasi Functions.
- `setup.sql`: tambahan tabel privat untuk pembatasan login antar-instance.
- `.env.production.example`: nama environment yang perlu diisi pada Vercel, tanpa nilai rahasia.
- `MANIFEST.sha256`: daftar hash berkas paket.

## Deploy singkat

1. Unggah isi folder ini ke GitHub. Jangan unggah folder backup atau file konfigurasi privat.
2. Import repository ke Vercel. Jika folder `SansWater` ikut berada di dalam repository, pilih Root Directory `SansWater`; jika isinya berada langsung di akar repository, pilih `./`.
3. Framework **Vite**, Node **24.x**, Install **npm ci**, Build **npm run build**, Output **dist**. API ditangani Functions; jangan mengisi Start Command `npm start` pada Vercel.
4. Isi tiga environment rahasia **Production**: DATABASE_URL, GAS_PHOTO_URL dan GAS_PHOTO_SECRET. Gunakan **Transaction pooler** Supabase, port **6543**, dengan role backend terbatas. Domain bawaan sudah `https://sanswater.vercel.app`; pengaturan nonrahasia lain tersedia otomatis. APP_ORIGIN dapat diisi jika memakai domain lain, tanpa slash akhir. Foto memakai URL dan secret GAS yang sama dengan sebelumnya.
5. Pada proyek Supabase depot yang sudah disiapkan, `setup.sql` telah diterapkan. Untuk pemulihan ke proyek lain yang sudah memiliki schema bisnis, jalankan SQL itu sekali melalui akun admin.
6. Deploy, periksa `/api/health`, lalu login dan uji dua perangkat pada alamat HTTPS aplikasi.

Tidak perlu mengimpor ulang data atau membuat owner baru. API Preview dimatikan secara bawaan agar branch percobaan tidak menulis ke database utama. Jangan membuka Preview API dengan database produksi.

## Perilaku server

SQLite hanya menjadi proyeksi **sementara di memori**, bukan penyimpanan utama. Satu bootstrap dipakai bersama oleh permintaan dalam instance yang sama. Instance baru memuat data dari Supabase; sesudah itu hanya perubahan yang diambil. Lock transaksi PostgreSQL, pemeriksaan versi dan kunci idempotensi tetap melindungi penyimpanan antar-instance. Kegagalan koneksi tidak membuat aplikasi menyimpan transaksi secara offline.

Cache foto privat maksimal 96 MiB secara bawaan berada di direktori sementara yang berbeda untuk tiap instance. Cache dapat hilang saat instance berganti; foto asli tetap di Drive. Izin selalu diperiksa sebelum foto dikirim, dan respons foto tidak disimpan di browser/CDN publik.

Koneksi pembaruan SSE diperbarui setiap sekitar empat menit, dengan sinyal versi kecil. Tab tersembunyi berhenti berlangganan. Tidak ada pengambilan ulang seluruh laporan setiap 30 detik. Instansiasi baru tetap menggunakan egress; penggunaan bulanan harus dipantau, tidak dijamin nol atau selalu di bawah suatu angka.

## Backup dan rahasia

Backup operasional dilakukan **dari komputer/admin terpisah**, dengan Node 24 dan konfigurasi privat yang sesuai: `npm ci`, lalu `npm run backup`. Jangan mengandalkan disk sementara Vercel untuk menyimpan backup. Simpan hasilnya secara privat di luar Vercel; foto Drive dicadangkan secara terpisah. Paket ini tidak memasang jadwal backup otomatis.

DATABASE_URL dan GAS_PHOTO_SECRET hanya untuk backend. Jangan memakai nama environment berawalan `VITE_` untuk rahasia, jangan masukkan password ke GitHub, dan jangan menaruh service-role key di browser. Pengaturan dan data asli tidak disertakan di folder ini.

Vercel Hobby memiliki kuota dan dibatasi untuk penggunaan pribadi nonkomersial. Pemakaian bisnis harus mengikuti ketentuan paket Vercel: [Hobby](https://vercel.com/docs/plans/hobby). Keberhasilan pengujian lokal tidak menggantikan verifikasi deployment dan kamera HP pada hosting tujuan.

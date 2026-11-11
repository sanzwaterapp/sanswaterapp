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

Paket sumber untuk GitHub berisi **99 berkas**, termasuk berkas konfigurasi tersembunyi. Folder `dist` adalah hasil build lokal dan tidak disertakan; Vercel membuatnya kembali melalui `npm run build`. Jika menjalankan build di komputer, jangan ikut mengunggah folder `dist` yang muncul. Berkas pemeriksaan hash paket lama disimpan terpisah di backup pengembangan.

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

## Pembaruan 5 November 2026

Ongkir disimpan per unit produk, dengan pilihan Rp1.000, Rp2.000 atau nominal manual. Total mengikuti jumlah produk; diskon baru hanya untuk RO dan Mineral. Pembayaran hutang tanpa pilihan tagihan dialokasikan ke tagihan tertua terlebih dahulu, lalu ke tagihan berikutnya. Pembelian di depot menerima nama kosong sebagai Pembeli umum; pembeli umum tetap wajib lunas.

Laporan kas menampilkan dua sumber pemasukan (Penjualan dan Bayar hutang), ditambah masing-masing pengeluaran beserta keterangannya. Ringkasan per staff memisahkan Tunai dan QRIS dengan rincian pengeluaran, tanpa mengirim daftar pelanggan pembayar. Daftar transaksi langsung dibuka dari parent akun. Form pengeluaran lebih ringkas dan memakai chip periode yang sama dengan Laporan.

TV mempertahankan seluruh pesanan aktif lintas hari, tertua lebih dahulu. Filter Aktif, Selesai dan Batal tersedia; daftar selesai/batal mengikuti aktivitas hari ini. Huruf diperbesar dengan baris rapat. Pembaruan ini memakai schema 14 yang sudah ada, tanpa impor ulang database atau perubahan akun. Foto tetap di GAS. Ongkir dan diskon historis yang sudah dibayar tetap dijaga.

Rincian produk memakai kartu compact: nama, jumlah dan total pada baris atas, dropdown ongkir serta diskon pada baris bawah. Pilihan ongkir adalah Tanpa ongkir, Rp1.000, Rp2.000 dan Manual. Input manual hanya ditampilkan saat dipilih; total kartu sudah termasuk ongkir dikali unit dan dikurangi diskon.

Kontrol air menyimpan tanggal operasional dan nomor shift yang dipilih. Angka awal tetap diambil dari penutupan terakhir; memilih tanggal tidak mengubah transaksi yang dihitung untuk shift tersebut. Laporan mengikuti tanggal operasional, termasuk jika shift ditutup lewat tengah malam. Detail menunjukkan perhitungan RO dan Mineral serta pemakaian liter per meteran. Catatan shift lama yang belum bernomor ditampilkan berurutan tanpa mengubah data aslinya.

## Pembaruan stabilitas 8 November 2026

Pencarian pada pemilih pelanggan menggunakan server dengan jeda 220 ms, maksimal 10 hasil, pembatalan pencarian lama, dan pengambilan pelanggan terpilih menurut ID. Daftar awal tetap dibatasi 2.000; pelanggan di luar daftar itu tetap dapat dipilih.

Pembaruan state mengirim hash untuk 14 kelompok data. Browser mengirim hash yang sudah dimiliki, sehingga server hanya mengembalikan kelompok yang berubah. Refresh bersamaan tetap digabung dan hasil sesi lama ditolak. Ini menghemat transfer ke browser; bukan penghapusan seluruh kebutuhan transfer dari Supabase.

Koneksi SSE yang diam lebih dari 75 detik diperiksa dan disambungkan kembali dengan backoff. Dalam kondisi normal, sinyal versi yang sama tetap tidak mengunduh ulang state. Tab tersembunyi menghentikan koneksi dan timer pemantau.

Saat mutasi menyertakan foto, validasi awal dibatalkan dahulu, lalu upload dan verifikasi GAS berjalan di luar lock transaksi bisnis. Sesudah itu sesi, izin dan aturan bisnis diperiksa kembali pada data Supabase terbaru sebelum commit. Kegagalan upload tidak mengakui transaksi berhasil. ID foto stabil untuk permintaan yang sama, termasuk saat retry lintas instance. Jika upload berhasil tetapi validasi akhir ditolak, file privat yang belum direferensikan dapat tertinggal di Drive; pembersihan file tersebut belum otomatis.

Bootstrap instance baru membaca record aktif dalam batch 1.000 dan melewati penanda penghapusan. Ini mengurangi puncak alokasi memori, tetapi seluruh histori aktif masih direkonstruksi. Untuk histori sangat besar, migrasi menuju query PostgreSQL langsung yang dibatasi periode/halaman masih diperlukan. Catatan idempotensi dan audit tidak dipangkas otomatis.

Antrean retry browser menyimpan digest SHA-256 dan kunci permintaan, bukan isi foto. Batas 256 hasil simpan yang belum pasti menahan pertumbuhan antrean tanpa membuang kunci replay; login/logout tetap dapat digunakan.

## Hapus pesanan — 10 November 2026

Akun Owner (admin) memiliki opsi **Hapus pesanan** pada dropdown status pesanan yang masih dapat diubah, termasuk dropdown pada tampilan TV. Konfirmasi menampilkan nama pelanggan sebelum menghapus. Staff dan Manager tidak melihat opsi tersebut dan ditolak bila memanggil API penghapusan secara langsung.

Penghapusan berlaku untuk pesanan pengantaran yang belum terkait trip, invoice atau pembayaran. Pesanan yang sudah terkait catatan tersebut tidak dihapus melalui menu ini agar riwayat transaksi, hutang, stok dan pengantaran tetap konsisten. Server memeriksa versi terbaru untuk mencegah penghapusan data yang telah berubah di perangkat lain. Penghapusan dicatat dalam audit dan memakai perlindungan retry yang sama dengan penyimpanan lainnya.

# Verifikasi paket SansWater — 5 November 2026

## Status

Paket telah disiapkan untuk diunggah ke GitHub dan dibangun oleh Vercel. Build frontend dan bundel Functions berhasil; pengujian adapter dan integrasi database nyata lulus. **Perubahan 5 November belum diterapkan pada deployment publik.** Domain akhir, environment di dashboard Vercel, kamera HP, reconnect melalui jaringan seluler dan kuota penggunaan tetap perlu diverifikasi setelah deployment.

## Kontrol air per shift — 5 November 2026

- Angka awal dan stok awal mengikuti penutupan shift terakhir, termasuk lintas tengah malam atau beberapa hari. Pencatatan pertama memakai awal operasional hari itu (00.00 WIB); staf mengisi angka meteran awal sekali.
- Tombol **Tutup shift & simpan** menyimpan angka, tiga foto dan stok sekaligus, dengan pesan sukses serta tautan laporan. Isian tetap ada jika penyimpanan gagal. Perubahan jumlah stok karena transaksi lain tidak lagi menolak laporan; perubahan kapasitas/nama/kelompok produk tetap diperiksa.
- Halaman `#waterreports`, dibuka dari tombol **Laporan** di Kontrol air, menyediakan filter tanggal/periode dan akun. Setiap catatan menyimpan identitas akun penutup, interval, jumlah pengantaran/depot, volume, stok, selisih, produk, dan ID foto. RO 1 + RO 2 digabung; Mineral terpisah. Selisih = meteran − (diserahkan + stok sisa − stok awal).
- Foto tetap melalui GAS/Drive pada konfigurasi produksi. Pengujian form memakai server QA terpisah dan foto uji lokal; bukan pengujian kamera HP atau upload GAS nyata setelah deploy. Foto diuji dapat dibuka kembali setelah penyimpanan dan refresh.
- Perbandingan meteran hanya mencakup produk RO/Mineral. Produk lain yang kapasitasnya aktif dicatat terpisah dan tidak mendistorsi selisih meteran.
- Preview lokal berisi enam catatan contoh tanggal 3–5 November dengan penutup Dina, Farhan, Putra dan owner; angka stok/meteran dan foto contoh tersedia. Pengisian ini idempotent, tidak mengubah transaksi/katalog/akun, dan tidak dikirim ke Supabase produksi atau disertakan sebagai database dalam paket GitHub.
- Ringkasan per periode hanya mengakumulasi shift baru; catatan harian lama ditandai terpisah agar tidak dijumlahkan ganda. Tanggal laporan adalah tanggal tutup shift di WIB. Identitas penutup merupakan snapshot sehingga penggantian nama akun tidak mengubah nama pada laporan lama.
- Daftar laporan dibatasi 30 catatan per halaman; rincian dan metadata foto baru diambil saat dibuka. Tidak menambah polling. Penyimpanan memakai kolom JSON yang sudah ada, schema tetap 14; tidak ada migrasi Supabase atau environment tambahan.
- Riwayat pengeluaran sudah menjadi dua baris, tanpa tanggal per card; periode multihari memakai dropdown per tanggal yang tertutup secara awal. Aksi Batalkan berupa tombol dan header per kas diperkuat warnanya. Catatan dan informasi pencatat tetap tersedia.

## Pembaruan alur kerja — 5 November 2026

Kode terbaru berada di folder SansWater; pembaruan ini belum diunggah ke GitHub atau deployment publik. Pratinjau pada localhost:3005 memakai database uji terpisah. Backup kode sebelumnya tersimpan di workspace pada backups/before-requests-20261105/SansWater. Data bisnis Supabase tidak diubah oleh perubahan fitur maupun pengujian ini.

- Ongkir per produk dikalikan kuantitas dan diklasifikasikan ke kas produknya; diskon baru dibatasi pada RO/Mineral. Harga/ongkir yang sudah dibayar, snapshot kas lama, permintaan perangkat lama, dan perubahan kuantitas diuji.
- Pembayaran tanpa daftar tagihan (termasuk array kosong) memakai FIFO dan mempertahankan sisa tagihan berikutnya. Nama pembeli depot opsional; hutang pembeli umum tetap ditolak.
- Laporan kas hanya menampilkan dua sumber pemasukan, serta baris pengeluaran dengan keterangan dan arah panah. Detail pengeluaran dimuat maksimal 30 per halaman, per staff atau per kas hanya ketika dibuka. Penjualan/pembayaran hutang nol disembunyikan; baris sisa saldo tetap tampil. Keterangan pengeluaran memakai catatan yang diisi, atau nama pengeluaran jika catatan kosong. Tidak ditambah polling otomatis.
- Transaksi pengantaran dikelompokkan per trip beserta tombol foto; periode multihari memiliki parent tanggal di atas trip. Transaksi depot langsung tampil tanpa parent trip tambahan. Nominal dan rincian biaya ditata ulang agar muat di layar HP. Periode Pengeluaran memakai chip Laporan dan form Pengeluaran dirapatkan. TV menampilkan pesanan aktif lintas hari, diurutkan berdasarkan durasi yang terlihat (terbesar dahulu, termasuk durasi yang berhenti saat berangkat); filter selesai/batal harian terpisah dan huruf besar memakai baris rapat.
- Penyempurnaan tampilan: rincian per kas dan per akun memakai tinggi baris, padding, ukuran huruf dan latar selang-seling yang sama; card Tunai berlatar biru muda, QRIS lavender, dan header trip abu-abu gelap dengan teks putih. Riwayat pengeluaran berlatar lavender dan dipadatkan lagi (sekitar 84 px tanpa catatan pada viewport 375 px), diringkas dengan nama/nominal, chip kas, metode, akun dan waktu; catatan serta aksi tetap tersedia. Tampilan dan form pembatalan diperiksa pada preview tanpa menyimpan pembatalan.
- Suite terbaru: 153 pengujian lulus, 0 gagal, 1 pengujian PostgreSQL integration dilewati pada run reguler. Build produksi Vite berhasil. Bundel resmi Vercel Node 24 berhasil dengan kedua modul backend tambahan ikut terkemas.
- Laporan per kas dan laporan per akun memakai komponen rincian yang sama: pemasukan penjualan, pembayaran hutang, pengeluaran per keterangan dan saldo per metode. Sumber pemasukan per kas memakai alokasi pembayaran aktual; pembayaran sebagian dan pembayaran di hari berikutnya diuji. Tidak perlu migration SQL.
- Pemeriksaan baca-saja sebelumnya ke Supabase nyata berhasil, foreign-key check bersih dan revisi tidak berubah. Schema tetap 14; tidak perlu migration SQL. Pengujian kamera HP/jaringan seluler dan pemakaian dua perangkat pada deployment publik tetap perlu setelah kode diunggah.

Bagian di bawah mencatat verifikasi migrasi ke Vercel pada 4 November; angka revisi, record dan pengujian di bagian tersebut adalah snapshot historis.

## Backup sebelum perubahan

Di workspace pengembangan, backup privat tersimpan pada `backups/pre-vercel-20261104`. Isinya mencakup arsip kode sebelum perubahan, konfigurasi privat, snapshot database dan hasil pencocokan. Backup pertama dibuat sebelum mengubah salinan SansWater. Koneksi langsung database mengalami masalah DNS; snapshot lokal kemudian dicocokkan dengan database utama berdasarkan revisi, jumlah record dan digest kanonis PostgreSQL, semuanya identik. Setelah Transaction pooler tersedia, snapshot baru juga berhasil diambil langsung dari Supabase.

Database bisnis memiliki schema 14, revisi 12 dan 1.226 record aktif pada saat pemeriksaan. Snapshot lolos integrity check dan foreign-key check. Seluruh 475 file yang terdapat pada arsip sumber lama dicocokkan kembali: tidak berubah. File sumber desain yang disetujui pada salinan ini mempunyai hash yang sama dengan versi asal.

Foto asli tetap di Google Drive. Arsip kode dan snapshot database bukan salinan lengkap isi folder Drive; cadangan foto harus dilakukan terpisah. Tidak ada password, backup, foto asli atau database bisnis dalam paket unggahan ini.

## Hasil tes

| Pemeriksaan | Hasil |
| --- | --- |
| Regresi dan kasus khusus Vercel | 156 tes lulus, 0 gagal. Satu pengujian integrasi sengaja dilewati pada run reguler dan dijalankan terpisah. |
| PostgreSQL melalui adapter Vercel | 16 tes lulus, termasuk dua backend, rebuild cache ketiga, sesi, perubahan bersamaan, replay, putus koneksi dan kegagalan GAS. |
| Builder resmi @vercel/node 29.0.1 | Bundel runtime `nodejs24.x` berhasil; entry API, modul server, limiter dan sertifikat CA ikut terkemas. Build dilakukan di komputer Windows; bukan uji deployment Linux publik. |
| Compiler routing resmi Vercel | Enam pola request API beserta query filter berhasil dicocokkan; routing dan header valid. |
| Bootstrap runtime dengan Supabase nyata | Health HTTP 200, state tanpa sesi HTTP 401, database existing dikenali sehingga setup owner tidak ditawarkan. |
| Perbaikan startup domain | Dengan hanya tiga kredensial backend, bootstrap berhasil, health HTTP 200, state anonim HTTP 401; domain `https://sanswater.vercel.app` dan Secure cookie diterapkan dari nilai bawaan yang divalidasi. |
| Pooler IPv4 | Berhasil terhubung melalui port 6543 memakai role backend terbatas, tanpa mematikan verifikasi TLS. |
| Pembatasan login lintas instance | 10 percobaan diterima untuk pemeriksaan, percobaan ke-11 ditolak dengan 429; setelah jendela berakhir akses pulih. Counter memakai tabel privat terpisah dari revisi bisnis. |
| Foto GAS dan cache | Satu foto trip terverifikasi: sekitar 4,4 detik dari GAS dan 8 ms dari cache, dengan byte identik. Ini waktu komponen backend pada satu sampel, bukan jaminan waktu klik HP. |
| Keamanan tabel limiter | RLS aktif; anon/authenticated tidak memiliki akses, role runtime memiliki izin terbatas pada tabel ini. |
| Dependensi | Instalasi dari lockfile berhasil; npm audit tidak melaporkan kerentanan pada pemeriksaan ini. |

Kasus baru yang diuji mencakup bootstrap serentak, pemulihan bootstrap gagal, raw/parsed request body, cookie, validasi origin, idempotensi, routing dan query filter, JSON 413, pesan error platform tanpa membocorkan rahasia, batas ukuran tiga foto, renewal SSE tanpa reload state, dan pembatalan antrean tanpa membiarkan dua request masuk ke satu scope SQLite. Setup owner lewat API publik juga ditolak, termasuk ketika proxy internal memakai alamat loopback.

Perbaikan setelah deployment pertama menambahkan nilai bawaan nonrahasia untuk domain, provider dan Secure cookie. APP_ORIGIN kosong atau placeholder GANTI dari contoh lama memakai domain tetap yang sudah ditentukan; request Host/Origin tidak dipakai untuk memilih domain yang diizinkan. Environment yang secara eksplisit melemahkan HTTPS/cookie tetap ditolak. Kredensial tetap hanya di dashboard Vercel. Error startup kini membedakan konfigurasi tidak lengkap dari kegagalan koneksi database, tanpa menampilkan nilai rahasia.

Tes menggunakan data terpisah dalam schema `depot_integration`. Schema uji dihapus setelah tes. Data bisnis utama tidak ditambah/dihapus oleh tes. Tambahan permanen pada Supabase hanya `depot_private.login_limits` beserta index, RLS dan izin backend yang diperlukan.

Advisor Supabase masih mempunyai peringatan leaked-password protection untuk provider Supabase Auth yang tidak dipakai runtime ini. Index expiry pada tabel limiter baru juga dilaporkan belum digunakan karena tabel produksi masih kosong; index dipertahankan untuk cleanup saat tabel bertambah. [Password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [unused index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Batas dan keputusan desain

- **Supabase tetap sumber kebenaran.** SQLite di memori hanya cache proyeksi yang dapat dibangun ulang. Commit PostgreSQL, lock transaksi dan pemeriksaan versi tetap berlaku lintas Functions. Tidak ada penyimpanan transaksi offline.
- **Cache tidak permanen.** Foto menggunakan `/tmp` unik per instance; default 96 MiB, maksimal 128 MiB. Instance baru dapat memuat ulang foto dari GAS dan metadata dari Supabase. Jangan menganggap foto selalu datang dari cache.
- **Egress tetap perlu dipantau.** Instance hangat menarik delta record, SSE mengirim versi kecil dan berhenti saat tab tersembunyi. Namun cold start memuat proyeksi lengkap. Saat ini serialisasi record aktif sekitar 0,5 MB; ukur kembali bila riwayat bertambah. Tidak ada janji pemakaian bulanan selalu di bawah 5 GB.
- **Batas waktu.** Functions dikonfigurasi 300 detik; SSE meminta renewal setelah 240 detik. Antrean scope data dibatasi 20 detik; saat penuh pengguna menerima 503 dan dapat mencoba kembali. Panggilan GAS dibatasi 12 detik per panggilan, sehingga tiga upload dan verifikasi tidak menahan transaksi tanpa batas.
- **Batas payload.** Aplikasi membatasi request/response sekitar 4 MB, di bawah batas platform 4,5 MB. Foto baru maksimal 600 KiB per gambar; kualitas dan dimensi diturunkan bertahap bila diperlukan. Foto lama tidak dikompresi ulang secara diam-diam.
- **Sesi dan izin.** Cookie HttpOnly/Secure/SameSite dan pemeriksaan server dipertahankan. Setup owner publik dimatikan; gunakan akun yang sudah ada. Login dibatasi per username secara lintas instance; aktivitas memakai sesi yang masih valid tidak menghabiskan percobaan login. Kebijakan panjang kata sandi tetap mengikuti aplikasi sebelumnya.
- **Backup di luar Vercel.** Tidak ada server worker/cron backup yang mengandalkan disk Functions. Admin perlu menjadwalkan backup dari lingkungan lain dan menguji pemulihan. Secret GAS dan database harus tetap privat.
- **Batas produk lama tetap berlaku.** Pagination pesanan 50, daftar pelanggan awal 2.000, rincian laporan 1.000 dengan peringatan bila terpotong, dan batas state historis tetap berlaku. Tidak menambahkan refund/retur atau antrean offline.

Panduan koneksi: [Supabase Transaction pooler](https://supabase.com/docs/guides/database/connecting-to-postgres#pooler-transaction-mode). Batas platform: [Vercel Functions](https://vercel.com/docs/functions/limitations).

# Verifikasi paket SansWater — 4 November 2026

## Status

Paket telah disiapkan untuk diunggah ke GitHub dan dibangun oleh Vercel. Build frontend dan bundel Functions berhasil; pengujian adapter dan integrasi database nyata lulus. **Deployment publik belum dibuat dari paket ini.** Domain akhir, environment di dashboard Vercel, kamera HP, reconnect melalui jaringan seluler dan kuota penggunaan tetap perlu diverifikasi setelah deployment.

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

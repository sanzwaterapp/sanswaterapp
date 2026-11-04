# Panduan deploy SansWater ke Vercel

## 1. Unggah paket yang benar

Gunakan folder **SansWater**, bukan folder paket Node/Docker yang lama. Unggah seluruh isi, termasuk `.gitignore`, `.vercelignore`, `.nvmrc` dan `.env.production.example`. `package.json` dan `vercel.json` harus berada langsung pada Root Directory yang dipilih Vercel.

Jangan unggah `backups`, `data`, `.env`, `*.private`, `node_modules`, `dist`, file SQLite atau foto. Berkas tersebut tidak diperlukan dalam repository produksi.

## 2. Isi pengaturan project Vercel

| Kolom | Nilai |
| --- | --- |
| Root Directory | `SansWater` bila folder itu ada di repository; `./` bila yang diunggah adalah isinya |
| Framework Preset | Vite |
| Node.js Version | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Fluid Compute | Aktif; juga ditentukan di `vercel.json` |
| Function duration | 300 detik, ditentukan di `vercel.json` |
| Region | `dub1`, dekat database Supabase proyek ini di Ireland |

Jangan mengisi perintah `npm start` sebagai Build Command. Vercel menjalankan API melalui `api/index.js`, bukan proses `server.listen()`.

## 3. Environment Production

Pada Settings → Environment Variables, tiga nilai yang wajib diisi untuk **Production** adalah DATABASE_URL, GAS_PHOTO_URL dan GAS_PHOTO_SECRET. Nilai rahasia diambil dari konfigurasi privat yang sudah ada; jangan kirim password melalui chat. Pengaturan nonrahasia di bawah sudah menjadi nilai bawaan kode. Nilai environment yang diisi manual tetap diperiksa, sehingga pengaturan tidak valid perlu dikoreksi.

| Nama | Nilai |
| --- | --- |
| DATA_PROVIDER | `supabase` |
| AUTH_PROVIDER | `local` |
| PHOTO_STORAGE | `gas` |
| SECURE_COOKIE | `true` |
| APP_ORIGIN | Bawaan `https://sanswater.vercel.app`; isi hanya jika memakai domain lain, tanpa slash akhir |
| DATABASE_URL | URI Transaction pooler Supabase dengan role `depot_runtime.PROJECT_REF`, password role tersebut dan port `6543` |
| GAS_PHOTO_URL | URL deployment GAS `/exec` yang sudah ada |
| GAS_PHOTO_SECRET | Secret 64 karakter hex yang sama dengan properti GAS |
| PHOTO_CACHE_MAX_MB | `96`; boleh `0` untuk mematikan, maksimal `128` |

NODE_ENV disetel `production` oleh Vercel. Tidak perlu DB_PATH, CLOUD_CACHE_PATH atau PHOTO_CACHE_PATH pada Vercel. Runtime sengaja memakai memori dan direktori sementara; path `/data` dari paket hosting lama tidak digunakan.

URI pooler untuk proyek ini memakai host `aws-0-eu-west-1.pooler.supabase.com`. Format berikut hanya contoh, bukan password asli:

```text
postgresql://depot_runtime.ntzvooqqplbnzixmkesh:PASSWORD_ROLE_YANG_SUDAH_ADA@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
```

Password harus di-URL-encode jika memiliki karakter khusus. Jangan memakai password akun aplikasi atau password role `postgres` untuk role `depot_runtime`. Jangan mengganti role menjadi admin hanya agar koneksi berhasil. Verifikasi TLS tetap aktif; root CA proyek dan root CA publik untuk pooler ikut disertakan.

APP_ORIGIN harus sama persis dengan alamat yang dibuka pengguna. Kode sudah memakai `https://sanswater.vercel.app` bila nilai ini kosong atau masih berupa placeholder GANTI dari contoh lama. Bila domain utama berubah, ubah nilai tersebut dan redeploy. Alias/deployment URL lain dapat membuka tampilan, tetapi mutasi ditolak jika origin-nya berbeda. Setelah mengganti environment, lakukan **Redeploy** agar Functions memakai nilai baru. Rahasia tetap wajib disimpan di dashboard; mengunggah kode tidak mengisi kredensial tersebut secara otomatis.

## 4. Supabase

Gunakan proyek depot yang sudah ada. Akun, password hash, sesi dan seluruh data bisnis tetap tersimpan di sana. Tidak perlu reset, import ulang, atau membuat owner.

Tabel privat `depot_private.login_limits` untuk pembatasan login telah ditambahkan pada proyek ini. `setup.sql` disertakan untuk pemulihan/instalasi ulang di proyek yang sudah memiliki schema bisnis. Tabel dibatasi hanya untuk role backend, dengan RLS aktif dan tanpa akses anon/authenticated. Tabel ini bukan log transaksi dan tidak memicu download state pada perangkat lain.

API Preview sengaja mengembalikan 503 secara bawaan. Jika perlu preview yang dapat menyimpan, gunakan database uji terpisah, origin preview yang tepat, lalu set ALLOW_PREVIEW_DATABASE=true hanya untuk lingkungan tersebut. Aplikasi tidak dapat membuktikan database benar-benar terpisah hanya dari flag ini; admin harus memastikan pemilihannya.

## 5. Pemeriksaan setelah deploy

1. Buka `https://DOMAIN/api/health`; harus HTTP 200 dengan `ok:true`.
2. Buka aplikasi dan login dengan username/password yang sudah ada. Gunakan domain yang sama dengan APP_ORIGIN.
3. Pada dua perangkat dengan sesi berbeda, lakukan transaksi uji yang dikenali. Periksa pembaruan, jumlah akhir produk dan saldo hutang.
4. Uji koneksi putus/retry dengan isian yang sama; periksa transaksi tidak tercatat ganda. Jangan menutup halaman ketika hasil simpan belum jelas.
5. Uji kamera absensi, foto trip dan tiga foto meteran pada HP nyata. Periksa gambar dapat dibuka kembali setelah Functions dimulai ulang.
6. Periksa Runtime Logs dan Usage pada Vercel serta egress Supabase. Jangan menyalakan debug yang mencetak password, cookie atau isi foto.

Request dibatasi sekitar 4 MB oleh aplikasi agar berada di bawah batas platform 4,5 MB. Foto baru dikompresi maksimal 600 KiB per gambar. Foto lama yang lebih besar dari batas respons tidak otomatis diubah. Rincian laporan besar dibatasi; gunakan periode lebih pendek jika melebihi batas.

## 6. Bila gagal

| Gejala | Pemeriksaan |
| --- | --- |
| Tampilan terbuka, API 404 | Root Directory salah, folder `api` belum ikut diunggah, atau `vercel.json` belum digunakan |
| API 503 dari awal | Periksa environment Production, koneksi pooler, kredensial role backend, GAS URL/secret dan status Supabase |
| API 503 dengan code DEPLOYMENT_CONFIG | Baca nama variabel pada respons, lalu isi/koreksi di Environment Variables Production dan redeploy; respons tidak menampilkan nilai rahasia |
| Login 403 asal permintaan | APP_ORIGIN berbeda dari domain yang sedang dibuka |
| Login 429 | Tunggu jendela pembatasan 15 menit; jangan mereset tabel untuk melewati pembatasan |
| Foto lambat pertama kali | Cache sementara kosong; Vercel mengambil foto dari GAS dan memverifikasi isinya |
| Simpan foto 503 | GAS sedang lambat/tidak tersedia atau foto belum terverifikasi; pertahankan isian dan coba tombol yang sama |
| Request 413 | Payload melebihi batas; ambil ulang/kurangi ukuran foto |

Paket sudah diuji melalui builder resmi `@vercel/node` untuk runtime Node 24 dan melalui adapter HTTP lokal dengan Supabase nyata. Deployment publik, domain akhir dan kamera HP tetap perlu diverifikasi setelah pengguna membuat project Vercel.

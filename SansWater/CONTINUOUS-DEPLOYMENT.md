# Continuous Deployment GitHub–Vercel

Alur: perubahan kode di `SansWater` → commit dan push ke GitHub → Vercel membangun dan memublikasikan versi baru.

Repository: https://github.com/sanzwaterapp/sanswaterapp, branch produksi `main`. Root Directory Vercel harus `SansWater`. Gunakan integrasi Git bawaan Vercel; tidak perlu workflow deployment GitHub Actions atau token Vercel di repository.

## Membarui aplikasi dari komputer ini

Jalankan dari folder `D:\File Aplikasi Develop\DEPOT AIR`:

```powershell
git status --short
git diff -- SansWater
npm --prefix SansWater run build
git add -- .gitignore SansWater
git diff --cached --stat
git diff --cached
git commit -m "Perbarui aplikasi SansWater"
git push origin main
```

Periksa perubahan sebelum commit. Edit kode produksi di folder `SansWater`; source pada akar workspace merupakan salinan pengembangan terpisah dan tidak ikut dipublikasikan. `.gitignore` membatasi repository ke paket Vercel serta mengecualikan dependency, hasil build, database, backup, `.env` privat dan `.vercel`. Contoh environment tanpa rahasia tetap boleh disertakan.

Git harus menggunakan akun yang memiliki izin tulis ke repository. Jika belum diatur, isi identitas commit memakai nama dan email GitHub sendiri:

```powershell
git config user.name "NAMA_GITHUB_ANDA"
git config user.email "EMAIL_COMMIT_GITHUB_ANDA"
```

Identitas commit tidak memberikan izin push. Gunakan akun GitHub yang memiliki akses tulis melalui Git Credential Manager bila akun tersimpan berbeda.

## Pengaturan Vercel

- Settings → Git: repository `sanzwaterapp/sanswaterapp`.
- Production Branch: `main`; deployment otomatis aktif.
- Root Directory: `SansWater`; Framework: Vite; Node: 24.x.
- Install: `npm ci`; Build: `npm run build`; Output: `dist`.
- Kredensial backend tetap di Environment Variables Production sesuai `DEPLOY-VERCEL.md`.

Push ke `main` memicu deployment produksi. Branch lain biasanya menghasilkan Preview; API Preview aplikasi ini dinonaktifkan secara bawaan. Setelah push, tunggu status Vercel berhasil pada commit GitHub dan periksa alamat aplikasi serta `/api/health`. Perubahan baru tersedia setelah build dan deployment berhasil.

Dokumentasi resmi: https://vercel.com/docs/git/vercel-for-github

## Hasil pemeriksaan 16 November 2026

Commit GitHub `bdc13df1bec834a455820a51ee7e2bda324252df` memiliki dua status berhasil: `Vercel – sanswater` dan `Vercel – sanswaterapp`. Integrasi GitHub–Vercel sudah tersedia untuk kedua proyek itu. Periksa proyek/domain yang dipakai pengguna sebelum memutus salah satu koneksi.

Pemeriksaan HTTP baca-saja: `https://sanswater.vercel.app/api/health` mengembalikan HTTP 200 dengan `ok:true`. Domain `sanswaterapp.vercel.app` mengembalikan HTTP 503 pada endpoint yang sama; keberhasilan build proyek itu belum membuktikan backend siap. Build produksi lokal `npm run build` pada folder `SansWater` berhasil. Rahasia dan hasil build terverifikasi diabaikan Git.

Folder kerja lokal sudah ditautkan ke `origin/main`. Akun GitHub tersimpan `appfresin` hanya memiliki izin baca pada repository ini; push memerlukan akun dengan izin tulis. Belum ada commit atau push baru dari penyiapan ini, sehingga deployment untuk perubahan lokal belum diuji.

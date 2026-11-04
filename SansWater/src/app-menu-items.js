import {
  ContactRound,
  Package,
  UsersRound,
  ChartNoAxesCombined,
  TvMinimal,
  Settings2,
  Wallet,
  Droplets,
} from "lucide-react";
import { can } from "./api.js";

const menuItems = [
  [
    "customers",
    "Pelanggan",
    "Kode dan data pelanggan",
    ContactRound,
    "customers",
  ],
  [
    "products",
    "Produk & stok",
    "Harga dan stok masuk",
    Package,
    "stock|catalog",
  ],
  [
    "staff",
    "Karyawan & akses",
    "Akun dan izin setiap staf",
    UsersRound,
    "staff",
  ],
  [
    "reports",
    "Laporan",
    "Penjualan dan riwayat transaksi",
    ChartNoAxesCombined,
    "reports",
  ],
  ["display", "Tampilan TV", "Pantau antrean pesanan", TvMinimal, "display"],
  [
    "watercontrol",
    "Kontrol air",
    "Meteran dan volume penjualan",
    Droplets,
    "waterControl|reports",
  ],
  [
    "expenses",
    "Pengeluaran",
    "Catatan pengeluaran per kas",
    Wallet,
    "expenses|reports",
  ],
  ["settings", "Pengaturan", "Durasi dan tampilan aplikasi", Settings2],
];

export function menuItemsFor(user) {
  return menuItems.filter(
    ([, , , , permission]) =>
      !permission || permission.split("|").some((key) => can(user, key)),
  );
}

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { referenceCapacity } from "../src/water-volume.js";
import {
  initializeCashFunds,
  initializeCategoryFunds,
  initializeFlexibleFunds,
} from "./cash-ledger.js";

export function openDatabase(path) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 14) {
    db.close();
    throw new Error("Versi basis data lebih baru daripada aplikasi ini.");
  }
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,password_hash TEXT NOT NULL,owner INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,permissions TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,category_id TEXT NOT NULL REFERENCES categories(id),tracked INTEGER NOT NULL,stock INTEGER NOT NULL DEFAULT 0,modes TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,whatsapp TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',photo_id TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_groups(prefix TEXT PRIMARY KEY COLLATE NOCASE,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY,number INTEGER NOT NULL,day TEXT NOT NULL,courier_id TEXT NOT NULL REFERENCES users(id),departed_at TEXT NOT NULL,closed_at TEXT,photo_id TEXT NOT NULL,UNIQUE(day,number));
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(id),name TEXT NOT NULL,code TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,kind TEXT NOT NULL,received_at TEXT NOT NULL,created_at TEXT NOT NULL,first_departure_at TEXT,status TEXT NOT NULL,current_trip_id TEXT REFERENCES trips(id),items TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),version INTEGER NOT NULL DEFAULT 1,reason TEXT);
    CREATE TABLE IF NOT EXISTS trip_orders(trip_id TEXT NOT NULL REFERENCES trips(id),order_id TEXT NOT NULL REFERENCES orders(id),outcome TEXT NOT NULL DEFAULT 'delivery',reason TEXT,recorded_at TEXT,PRIMARY KEY(trip_id,order_id));
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip ON trip_orders(order_id) WHERE outcome='delivery';
    CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),customer_id TEXT REFERENCES customers(id),customer_name TEXT NOT NULL,customer_code TEXT NOT NULL,trip_id TEXT REFERENCES trips(id),net INTEGER NOT NULL,shipping INTEGER NOT NULL,discount INTEGER NOT NULL,items TEXT NOT NULL,discounts TEXT NOT NULL,recorded_at TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(id),amount INTEGER NOT NULL CHECK(amount>=0),method TEXT NOT NULL CHECK(method IN ('Tunai','QRIS')),tender INTEGER,proof_id TEXT,scope TEXT NOT NULL,created_at TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS allocations(payment_id TEXT NOT NULL REFERENCES payments(id),invoice_id TEXT NOT NULL REFERENCES invoices(id),amount INTEGER NOT NULL CHECK(amount>0),PRIMARY KEY(payment_id,invoice_id));
    CREATE TABLE IF NOT EXISTS stock_movements(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),qty INTEGER NOT NULL,kind TEXT NOT NULL,invoice_id TEXT REFERENCES invoices(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,note TEXT NOT NULL,UNIQUE(invoice_id,product_id));
    CREATE TABLE IF NOT EXISTS attendance(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,created_at TEXT NOT NULL,photo_id TEXT NOT NULL,UNIQUE(user_id,day));
    CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),mime TEXT NOT NULL,bytes BLOB NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,object_id TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS idempotency(user_id TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,key));
    CREATE INDEX IF NOT EXISTS invoice_period ON invoices(recorded_at);
    CREATE INDEX IF NOT EXISTS invoice_customer ON invoices(customer_id,recorded_at);
    CREATE INDEX IF NOT EXISTS payment_period ON payments(created_at);
    CREATE INDEX IF NOT EXISTS allocation_invoice ON allocations(invoice_id);
    CREATE INDEX IF NOT EXISTS order_status ON orders(status,created_at);
    CREATE INDEX IF NOT EXISTS order_created_period ON orders(created_at);
    CREATE INDEX IF NOT EXISTS trip_courier ON trips(courier_id,departed_at);
    CREATE INDEX IF NOT EXISTS audit_object_action ON audit(object_id,action);
    `);
  if (
    !db
      .prepare("PRAGMA table_info(trip_orders)")
      .all()
      .some((column) => column.name === "items")
  ) {
    transaction(db, () =>
      db.exec(
        "ALTER TABLE trip_orders ADD COLUMN items TEXT NOT NULL DEFAULT '[]'; UPDATE trip_orders SET items=(SELECT items FROM orders WHERE orders.id=trip_orders.order_id); PRAGMA user_version=2;",
      ),
    );
  }
  if (version < 3) {
    transaction(db, () => {
      for (const customer of db
        .prepare("SELECT code,created_at FROM customers")
        .all()) {
        ensureCustomerGroup(db, customer.code, customer.created_at);
      }
      db.exec("PRAGMA user_version=3");
    });
  }
  if (version < 4) {
    transaction(db, () => {
      if (
        !db
          .prepare("PRAGMA table_info(customers)")
          .all()
          .some((column) => column.name === "group_prefix")
      )
        db.exec(
          "ALTER TABLE customers ADD COLUMN group_prefix TEXT REFERENCES customer_groups(prefix)",
        );
      for (const customer of db
        .prepare(
          "SELECT id,code,created_at FROM customers WHERE group_prefix IS NULL",
        )
        .all()) {
        ensureCustomerGroup(db, customer.code, customer.created_at);
        const prefix = customer.code.match(/^[A-Z]+/i)?.[0].toUpperCase();
        if (prefix)
          db.prepare("UPDATE customers SET group_prefix=? WHERE id=?").run(
            prefix,
            customer.id,
          );
      }
      db.exec("PRAGMA user_version=4");
    });
  }
  if (version < 5) {
    transaction(db, () => {
      if (
        !db
          .prepare("PRAGMA table_info(orders)")
          .all()
          .some((column) => column.name === "discounts")
      )
        db.exec(
          "ALTER TABLE orders ADD COLUMN discounts TEXT NOT NULL DEFAULT '{}'",
        );
      db.exec("PRAGMA user_version=5");
    });
  }
  if (version < 6) {
    transaction(db, () =>
      db.exec(`
      CREATE TABLE IF NOT EXISTS order_prepayments(
        order_id TEXT PRIMARY KEY REFERENCES orders(id),
        payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
        shipping INTEGER NOT NULL,
        items TEXT NOT NULL,
        discounts TEXT NOT NULL
      );
      PRAGMA user_version=6;
    `),
    );
  }
  if (version < 7)
    transaction(db, () => {
      initializeCashFunds(db);
      db.exec("PRAGMA user_version=7");
    });
  if (version < 8)
    transaction(db, () => {
      initializeCategoryFunds(db);
      db.exec("PRAGMA user_version=8");
    });
  if (version < 9)
    transaction(db, () => {
      initializeFlexibleFunds(db);
      db.exec("PRAGMA user_version=9");
    });
  if (version < 10)
    transaction(db, () => {
      if (
        !db
          .prepare("PRAGMA table_info(products)")
          .all()
          .some((column) => column.name === "capacity_liters")
      ) {
        db.exec(
          "ALTER TABLE products ADD COLUMN capacity_liters REAL CHECK(capacity_liters IS NULL OR (capacity_liters>0 AND capacity_liters<=1000000))",
        );
        const update = db.prepare(
          "UPDATE products SET capacity_liters=?,version=version+1 WHERE id=?",
        );
        for (const product of db
          .prepare("SELECT id,name FROM products")
          .all()) {
          const capacity = referenceCapacity(product.name);
          if (capacity !== null) update.run(capacity, product.id);
        }
      }
      db.exec("PRAGMA user_version=10");
    });
  if (version < 11)
    transaction(db, () =>
      db.exec(`CREATE TABLE IF NOT EXISTS water_checks(
      id TEXT PRIMARY KEY,previous_id TEXT UNIQUE REFERENCES water_checks(id),
      start_at TEXT NOT NULL,created_at TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),
      readings TEXT NOT NULL,usage_liters REAL NOT NULL CHECK(usage_liters>=0),sales_liters REAL NOT NULL,
      legacy_invoices INTEGER NOT NULL,invoice_cursor INTEGER NOT NULL);
      PRAGMA user_version=11;`),
    );
  if (version < 12)
    transaction(db, () =>
      db.exec(`CREATE TABLE IF NOT EXISTS photo_storage(
      photo_id TEXT PRIMARY KEY REFERENCES photos(id),
      status TEXT NOT NULL CHECK(status IN ('pending','uploaded')),
      sha256 TEXT NOT NULL,byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=5242880),
      file_id TEXT,uploaded_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER NOT NULL DEFAULT 0,last_error TEXT,
      CHECK(status<>'uploaded' OR (file_id IS NOT NULL AND uploaded_at IS NOT NULL)));
      CREATE INDEX IF NOT EXISTS photo_storage_pending ON photo_storage(status,next_retry_at);
      PRAGMA user_version=12;`),
    );
  if (version < 13)
    transaction(db, () => {
      const columns = db.prepare("PRAGMA table_info(water_checks)").all();
      if (!columns.some((column) => column.name === "stock_snapshot"))
        db.exec("ALTER TABLE water_checks ADD COLUMN stock_snapshot TEXT");
      if (!columns.some((column) => column.name === "comparison_snapshot"))
        db.exec("ALTER TABLE water_checks ADD COLUMN comparison_snapshot TEXT");
      db.exec("PRAGMA user_version=13");
    });
  if (version < 14) {
    // Retain invoice IDs and rowids: allocations, stock movements and the water
    // report cursor must keep referring to exactly the same historical rows.
    db.exec("PRAGMA foreign_keys=OFF");
    try {
      transaction(db, () => {
        db.exec(`CREATE TABLE invoices_v14(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),customer_id TEXT REFERENCES customers(id),customer_name TEXT NOT NULL,customer_code TEXT NOT NULL,trip_id TEXT REFERENCES trips(id),net INTEGER NOT NULL,shipping INTEGER NOT NULL,discount INTEGER NOT NULL,items TEXT NOT NULL,discounts TEXT NOT NULL,recorded_at TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id));
          INSERT INTO invoices_v14(rowid,id,order_id,customer_id,customer_name,customer_code,trip_id,net,shipping,discount,items,discounts,recorded_at,actor_id) SELECT rowid,* FROM invoices;
          DROP TABLE invoices;
          ALTER TABLE invoices_v14 RENAME TO invoices;
          CREATE INDEX invoice_period ON invoices(recorded_at);
          CREATE INDEX invoice_customer ON invoices(customer_id,recorded_at);
          CREATE INDEX invoice_trip_period ON invoices(trip_id,recorded_at,id);
          CREATE INDEX invoice_order ON invoices(order_id);
          CREATE UNIQUE INDEX invoice_trip_once ON invoices(order_id,trip_id) WHERE trip_id IS NOT NULL;
          CREATE UNIQUE INDEX invoice_counter_once ON invoices(order_id) WHERE trip_id IS NULL;
          PRAGMA user_version=14;`);
        if (db.prepare("PRAGMA foreign_key_check").all().length)
          throw new Error("Migrasi riwayat pengantaran tidak konsisten.");
      });
    } finally {
      db.exec("PRAGMA foreign_keys=ON");
    }
  }
  return db;
}

export function ensureCustomerGroup(db, code, createdAt) {
  const prefix = code.match(/^[A-Z]+/i)?.[0].toUpperCase();
  if (prefix)
    db.prepare(
      "INSERT OR IGNORE INTO customer_groups(prefix,name,created_at) VALUES(?,?,?)",
    ).run(prefix, "Kelompok " + prefix, createdAt);
}

export function transaction(db, work) {
  const nested = db.isTransaction;
  db.exec(nested ? "SAVEPOINT business_work" : "BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec(nested ? "RELEASE SAVEPOINT business_work" : "COMMIT");
    return result;
  } catch (error) {
    db.exec(
      nested
        ? "ROLLBACK TO SAVEPOINT business_work; RELEASE SAVEPOINT business_work"
        : "ROLLBACK",
    );
    throw error;
  }
}

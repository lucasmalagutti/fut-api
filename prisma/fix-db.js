const Database = require('better-sqlite3');
const db = new Database('prisma/dev.db');

db.exec('DROP TABLE IF EXISTS new_Payment; DROP TABLE IF EXISTS new_Wallet;');

const payCols = db.prepare('PRAGMA table_info(Payment)').all().map((c) => c.name);
if (!payCols.includes('userId')) {
  db.exec(`
    PRAGMA defer_foreign_keys=ON;
    PRAGMA foreign_keys=OFF;
    CREATE TABLE new_Payment (
      id TEXT NOT NULL PRIMARY KEY,
      userId TEXT NOT NULL,
      bookingId TEXT,
      purpose TEXT NOT NULL,
      method TEXT NOT NULL,
      gatewayRef TEXT NOT NULL,
      qrCode TEXT,
      qrCodeUrl TEXT,
      amount REAL NOT NULL,
      fee REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      paidAt DATETIME,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO new_Payment
    SELECT p.id, COALESCE(b.playerId, 'legacy'), p.bookingId, 'booking_host', p.method,
           p.gatewayRef, p.qrCode, p.qrCodeUrl, p.amount, p.fee, p.status, p.paidAt, p.createdAt
    FROM Payment p
    LEFT JOIN Booking b ON b.id = p.bookingId;
    DROP TABLE Payment;
    ALTER TABLE new_Payment RENAME TO Payment;
    CREATE INDEX IF NOT EXISTS Payment_bookingId_idx ON Payment(bookingId);
    CREATE INDEX IF NOT EXISTS Payment_userId_idx ON Payment(userId);
    PRAGMA foreign_keys=ON;
  `);
  console.log('Payment table updated');
}

const wCols = db.prepare('PRAGMA table_info(Wallet)').all().map((c) => c.name);
if (!wCols.includes('pendingBalance')) {
  db.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE new_Wallet (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL UNIQUE,
      balance REAL NOT NULL DEFAULT 0,
      pendingBalance REAL NOT NULL DEFAULT 0,
      updatedAt DATETIME NOT NULL
    );
    INSERT INTO new_Wallet SELECT id, userId, balance, 0, updatedAt FROM Wallet;
    DROP TABLE Wallet;
    ALTER TABLE new_Wallet RENAME TO Wallet;
    PRAGMA foreign_keys=ON;
  `);
  console.log('Wallet table updated');
}

console.log('Database fix complete');

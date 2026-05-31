-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT,
    "purpose" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "gatewayRef" TEXT NOT NULL,
    "qrCode" TEXT,
    "qrCodeUrl" TEXT,
    "amount" REAL NOT NULL,
    "fee" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("id", "userId", "bookingId", "purpose", "method", "gatewayRef", "qrCode", "qrCodeUrl", "amount", "fee", "status", "paidAt", "createdAt")
SELECT
  p."id",
  COALESCE(b."playerId", 'legacy'),
  p."bookingId",
  'booking_host',
  p."method",
  p."gatewayRef",
  p."qrCode",
  p."qrCodeUrl",
  p."amount",
  p."fee",
  p."status",
  p."paidAt",
  p."createdAt"
FROM "Payment" p
LEFT JOIN "Booking" b ON b."id" = p."bookingId";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");
CREATE TABLE "new_Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "balance" REAL NOT NULL DEFAULT 0,
    "pendingBalance" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Wallet" ("balance", "id", "updatedAt", "userId") SELECT "balance", "id", "updatedAt", "userId" FROM "Wallet";
DROP TABLE "Wallet";
ALTER TABLE "new_Wallet" RENAME TO "Wallet";
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

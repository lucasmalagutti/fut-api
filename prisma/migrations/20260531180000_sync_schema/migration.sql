-- AlterTable
ALTER TABLE "Court" ADD COLUMN "mapsUrl" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "qrCodeUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "blockReason" TEXT;
ALTER TABLE "User" ADD COLUMN "blockedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "stripeAccountId" TEXT;
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courtId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "totalPrice" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "cancellationReason" TEXT,
    "ownerCreditedAt" DATETIME,
    "payoutReleasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("cancellationReason", "courtId", "createdAt", "endsAt", "id", "playerId", "startsAt", "status", "totalPrice") SELECT "cancellationReason", "courtId", "createdAt", "endsAt", "id", "playerId", "startsAt", "status", "totalPrice" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE INDEX "Booking_courtId_startsAt_endsAt_idx" ON "Booking"("courtId", "startsAt", "endsAt");
CREATE TABLE "new_CourtPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courtId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourtPhoto_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CourtPhoto" ("courtId", "id", "position", "url") SELECT "courtId", "id", "position", "url" FROM "CourtPhoto";
DROP TABLE "CourtPhoto";
ALTER TABLE "new_CourtPhoto" RENAME TO "CourtPhoto";
CREATE TABLE "new_Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "minPlayers" INTEGER NOT NULL DEFAULT 2,
    "maxPlayers" INTEGER NOT NULL DEFAULT 10,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" DATETIME,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Match_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Match" ("bookingId", "createdAt", "hostId", "id", "isPublic", "sport") SELECT "bookingId", "createdAt", "hostId", "id", "isPublic", "sport" FROM "Match";
DROP TABLE "Match";
ALTER TABLE "new_Match" RENAME TO "Match";
CREATE UNIQUE INDEX "Match_bookingId_key" ON "Match"("bookingId");
CREATE TABLE "new_MatchParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guestName" TEXT,
    "slots" INTEGER NOT NULL DEFAULT 1,
    "quota" REAL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'joined',
    "paymentId" TEXT,
    CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Preserva status antigo como paymentStatus (schema legado usava coluna "status")
INSERT INTO "new_MatchParticipant" ("id", "matchId", "userId", "paymentStatus")
SELECT "id", "matchId", "userId", "status" FROM "MatchParticipant";
DROP TABLE "MatchParticipant";
ALTER TABLE "new_MatchParticipant" RENAME TO "MatchParticipant";
CREATE UNIQUE INDEX "MatchParticipant_matchId_userId_key" ON "MatchParticipant"("matchId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

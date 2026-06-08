/*
  Warnings:

  - Added the required column `requestHash` to the `idempotency_keys` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_idempotency_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseBody" JSONB NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_idempotency_keys" ("createdAt", "expiresAt", "id", "key", "responseBody", "route", "statusCode") SELECT "createdAt", "expiresAt", "id", "key", "responseBody", "route", "statusCode" FROM "idempotency_keys";
DROP TABLE "idempotency_keys";
ALTER TABLE "new_idempotency_keys" RENAME TO "idempotency_keys";
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

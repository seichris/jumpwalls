/*
  Warnings:

  - You are about to drop the column `escrowed` on the `Bounty` table. All the data in the column will be lost.
  - You are about to drop the column `totalFunded` on the `Bounty` table. All the data in the column will be lost.
  - You are about to drop the column `totalPaid` on the `Bounty` table. All the data in the column will be lost.
  - Added the required column `lockedUntil` to the `Funding` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token` to the `Funding` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token` to the `Payout` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token` to the `Refund` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "BountyAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "escrowed" TEXT NOT NULL DEFAULT '0',
    "funded" TEXT NOT NULL DEFAULT '0',
    "paid" TEXT NOT NULL DEFAULT '0',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BountyAsset_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("bountyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bounty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "repoHash" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "metadataURI" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bounty_repoHash_fkey" FOREIGN KEY ("repoHash") REFERENCES "Repo" ("repoHash") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Bounty" ("bountyId", "chainId", "contractAddress", "createdAt", "id", "issueNumber", "metadataURI", "repoHash", "status", "updatedAt") SELECT "bountyId", "chainId", "contractAddress", "createdAt", "id", "issueNumber", "metadataURI", "repoHash", "status", "updatedAt" FROM "Bounty";
DROP TABLE "Bounty";
ALTER TABLE "new_Bounty" RENAME TO "Bounty";
CREATE UNIQUE INDEX "Bounty_bountyId_key" ON "Bounty"("bountyId");
CREATE UNIQUE INDEX "Bounty_repoHash_issueNumber_chainId_contractAddress_key" ON "Bounty"("repoHash", "issueNumber", "chainId", "contractAddress");
CREATE TABLE "new_Funding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "lockedUntil" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Funding_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("bountyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Funding" ("amountWei", "blockNumber", "bountyId", "createdAt", "funder", "id", "logIndex", "txHash") SELECT "amountWei", "blockNumber", "bountyId", "createdAt", "funder", "id", "logIndex", "txHash" FROM "Funding";
DROP TABLE "Funding";
ALTER TABLE "new_Funding" RENAME TO "Funding";
CREATE UNIQUE INDEX "Funding_txHash_logIndex_key" ON "Funding"("txHash", "logIndex");
CREATE TABLE "new_Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payout_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("bountyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Payout" ("amountWei", "blockNumber", "bountyId", "createdAt", "id", "logIndex", "recipient", "txHash") SELECT "amountWei", "blockNumber", "bountyId", "createdAt", "id", "logIndex", "recipient", "txHash" FROM "Payout";
DROP TABLE "Payout";
ALTER TABLE "new_Payout" RENAME TO "Payout";
CREATE UNIQUE INDEX "Payout_txHash_logIndex_key" ON "Payout"("txHash", "logIndex");
CREATE TABLE "new_Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("bountyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Refund" ("amountWei", "blockNumber", "bountyId", "createdAt", "funder", "id", "logIndex", "txHash") SELECT "amountWei", "blockNumber", "bountyId", "createdAt", "funder", "id", "logIndex", "txHash" FROM "Refund";
DROP TABLE "Refund";
ALTER TABLE "new_Refund" RENAME TO "Refund";
CREATE UNIQUE INDEX "Refund_txHash_logIndex_key" ON "Refund"("txHash", "logIndex");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BountyAsset_bountyId_token_key" ON "BountyAsset"("bountyId", "token");

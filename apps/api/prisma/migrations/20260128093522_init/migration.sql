-- CreateTable
CREATE TABLE "Repo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repoHash" TEXT NOT NULL,
    "maintainerAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Bounty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "repoHash" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "metadataURI" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalFunded" TEXT NOT NULL DEFAULT '0',
    "totalPaid" TEXT NOT NULL DEFAULT '0',
    "escrowed" TEXT NOT NULL DEFAULT '0',
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bounty_repoHash_fkey" FOREIGN KEY ("repoHash") REFERENCES "Repo" ("repoHash") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Funding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Funding_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("bountyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "claimId" INTEGER NOT NULL,
    "claimer" TEXT NOT NULL,
    "metadataURI" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Claim_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("bountyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payout_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("bountyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("bountyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IndexerState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "lastBlock" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Repo_repoHash_key" ON "Repo"("repoHash");

-- CreateIndex
CREATE UNIQUE INDEX "Bounty_bountyId_key" ON "Bounty"("bountyId");

-- CreateIndex
CREATE UNIQUE INDEX "Bounty_repoHash_issueNumber_chainId_contractAddress_key" ON "Bounty"("repoHash", "issueNumber", "chainId", "contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Funding_txHash_logIndex_key" ON "Funding"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_bountyId_claimId_key" ON "Claim"("bountyId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_txHash_logIndex_key" ON "Claim"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_txHash_logIndex_key" ON "Payout"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_txHash_logIndex_key" ON "Refund"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "IndexerState_chainId_contractAddress_key" ON "IndexerState"("chainId", "contractAddress");

-- CreateTable
CREATE TABLE "TreasuryBountyLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "totalFundedUsdc" TEXT NOT NULL DEFAULT '0',
    "totalPaidUsdc" TEXT NOT NULL DEFAULT '0',
    "availableUsdc" TEXT NOT NULL DEFAULT '0',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TreasuryFundingIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "sourceChainId" INTEGER NOT NULL,
    "amountUsdc" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "burnIntentJson" TEXT,
    "burnIntentSignature" TEXT,
    "gatewayAttestation" TEXT,
    "gatewayAttestationSignature" TEXT,
    "arcMintTxHash" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TreasuryPayoutIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "destinationChain" TEXT NOT NULL,
    "amountUsdc" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bridgeTxHash" TEXT,
    "finalTxHash" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryBountyLedger_bountyId_key" ON "TreasuryBountyLedger"("bountyId");

-- CreateIndex
CREATE INDEX "TreasuryFundingIntent_bountyId_idx" ON "TreasuryFundingIntent"("bountyId");

-- CreateIndex
CREATE INDEX "TreasuryFundingIntent_status_idx" ON "TreasuryFundingIntent"("status");

-- CreateIndex
CREATE INDEX "TreasuryPayoutIntent_bountyId_idx" ON "TreasuryPayoutIntent"("bountyId");

-- CreateIndex
CREATE INDEX "TreasuryPayoutIntent_status_idx" ON "TreasuryPayoutIntent"("status");

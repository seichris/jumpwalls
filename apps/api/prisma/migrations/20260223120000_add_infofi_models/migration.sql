-- CreateTable
CREATE TABLE "InfoFiRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "maxAmountWei" TEXT NOT NULL,
    "sourceURI" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "hiredOfferId" TEXT,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "consultant" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "etaSeconds" INTEGER NOT NULL,
    "proofType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "consultant" TEXT NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "remainingWei" TEXT NOT NULL,
    "digestHash" TEXT,
    "metadataURI" TEXT,
    "proofTypeOrURI" TEXT,
    "hiredAt" DATETIME NOT NULL,
    "deliveredAt" DATETIME,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InfoFiRefund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "funder" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InfoFiRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "rater" TEXT NOT NULL,
    "rated" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "uri" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InfoFiDigest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "sourceURI" TEXT,
    "question" TEXT,
    "digest" TEXT NOT NULL,
    "digestHash" TEXT NOT NULL,
    "metadataURI" TEXT NOT NULL,
    "consultantAddress" TEXT NOT NULL,
    "proof" TEXT,
    "citationsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiRequest_requestId_key" ON "InfoFiRequest"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiOffer_offerId_key" ON "InfoFiOffer"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiJob_jobId_key" ON "InfoFiJob"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiJob_requestId_key" ON "InfoFiJob"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiJob_offerId_key" ON "InfoFiJob"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiPayout_txHash_logIndex_key" ON "InfoFiPayout"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiRefund_txHash_logIndex_key" ON "InfoFiRefund"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiRating_jobId_rater_key" ON "InfoFiRating"("jobId", "rater");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiRating_txHash_logIndex_key" ON "InfoFiRating"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiDigest_metadataURI_key" ON "InfoFiDigest"("metadataURI");

-- CreateIndex
CREATE INDEX "InfoFiDigest_jobId_idx" ON "InfoFiDigest"("jobId");

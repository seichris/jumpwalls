-- CreateTable
CREATE TABLE "InfoFiUserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evmAddress" TEXT NOT NULL,
    "fastAddress" TEXT,
    "fastPublicKey" TEXT,
    "fastBoundAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiUserAuthChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evmAddress" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "fastAddress" TEXT,
    "fastPublicKey" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InfoFiUserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "evmAddress" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiFastRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "requesterFastAddress" TEXT NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "maxAmountWei" TEXT NOT NULL,
    "sourceURI" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "hiredOfferId" TEXT,
    "fundingTxHash" TEXT NOT NULL,
    "fundingNonce" INTEGER NOT NULL,
    "fundingCertificateJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiFastOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "consultant" TEXT NOT NULL,
    "consultantFastAddress" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "etaSeconds" INTEGER NOT NULL,
    "proofType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiFastJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "requesterFastAddress" TEXT NOT NULL,
    "consultant" TEXT NOT NULL,
    "consultantFastAddress" TEXT NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "remainingWei" TEXT NOT NULL,
    "digestHash" TEXT,
    "metadataURI" TEXT,
    "proofTypeOrURI" TEXT,
    "status" TEXT NOT NULL,
    "hiredAt" DATETIME NOT NULL,
    "deliveredAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiFastTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalRef" TEXT NOT NULL,
    "requestId" TEXT,
    "jobId" TEXT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amountWei" TEXT NOT NULL,
    "txHash" TEXT,
    "nonce" INTEGER,
    "certificateJson" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiUserProfile_evmAddress_key" ON "InfoFiUserProfile"("evmAddress");

-- CreateIndex
CREATE INDEX "InfoFiUserProfile_fastAddress_idx" ON "InfoFiUserProfile"("fastAddress");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiUserAuthChallenge_nonce_key" ON "InfoFiUserAuthChallenge"("nonce");

-- CreateIndex
CREATE INDEX "InfoFiUserAuthChallenge_evmAddress_purpose_expiresAt_idx" ON "InfoFiUserAuthChallenge"("evmAddress", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiUserSession_tokenHash_key" ON "InfoFiUserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "InfoFiUserSession_evmAddress_expiresAt_idx" ON "InfoFiUserSession"("evmAddress", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiFastRequest_requestId_key" ON "InfoFiFastRequest"("requestId");

-- CreateIndex
CREATE INDEX "InfoFiFastRequest_requester_status_updatedAt_idx" ON "InfoFiFastRequest"("requester", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiFastOffer_offerId_key" ON "InfoFiFastOffer"("offerId");

-- CreateIndex
CREATE INDEX "InfoFiFastOffer_requestId_status_updatedAt_idx" ON "InfoFiFastOffer"("requestId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "InfoFiFastOffer_consultant_status_updatedAt_idx" ON "InfoFiFastOffer"("consultant", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiFastJob_jobId_key" ON "InfoFiFastJob"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiFastJob_requestId_key" ON "InfoFiFastJob"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiFastJob_offerId_key" ON "InfoFiFastJob"("offerId");

-- CreateIndex
CREATE INDEX "InfoFiFastJob_requester_status_updatedAt_idx" ON "InfoFiFastJob"("requester", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "InfoFiFastJob_consultant_status_updatedAt_idx" ON "InfoFiFastJob"("consultant", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiFastTransfer_externalRef_key" ON "InfoFiFastTransfer"("externalRef");

-- CreateIndex
CREATE INDEX "InfoFiFastTransfer_requestId_direction_createdAt_idx" ON "InfoFiFastTransfer"("requestId", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "InfoFiFastTransfer_jobId_direction_createdAt_idx" ON "InfoFiFastTransfer"("jobId", "direction", "createdAt");

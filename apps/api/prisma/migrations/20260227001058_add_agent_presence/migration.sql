-- CreateTable
CREATE TABLE "InfoFiAgentProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentAddress" TEXT NOT NULL,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiAgentCapability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentAddress" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "paymentToken" TEXT NOT NULL,
    "minAmountWei" TEXT NOT NULL,
    "maxAmountWei" TEXT NOT NULL,
    "etaSeconds" INTEGER NOT NULL,
    "minConfidence" REAL NOT NULL DEFAULT 0.65,
    "proofTypeDefault" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiAgentHeartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentAddress" TEXT NOT NULL,
    "domainsLoggedInJson" TEXT NOT NULL,
    "expectedEtaJson" TEXT,
    "lastSeenAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "signatureDigest" TEXT NOT NULL,
    "clientVersion" TEXT,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InfoFiAgentDecisionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentAddress" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonDetail" TEXT,
    "offerAmountWei" TEXT,
    "etaSeconds" INTEGER,
    "offerId" TEXT,
    "txHash" TEXT,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InfoFiAgentAuthChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentAddress" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InfoFiDomainDemandSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "signalCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueClientCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InfoFiDomainDemandSignalClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "clientIdHash" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "InfoFiAgentProfile_status_updatedAt_idx" ON "InfoFiAgentProfile"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiAgentProfile_agentAddress_chainId_contractAddress_key" ON "InfoFiAgentProfile"("agentAddress", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "InfoFiAgentCapability_agentAddress_chainId_contractAddress_idx" ON "InfoFiAgentCapability"("agentAddress", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "InfoFiAgentCapability_domain_isEnabled_chainId_contractAddress_idx" ON "InfoFiAgentCapability"("domain", "isEnabled", "chainId", "contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiAgentCapability_agentAddress_domain_paymentToken_chainId_contractAddress_key" ON "InfoFiAgentCapability"("agentAddress", "domain", "paymentToken", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "InfoFiAgentHeartbeat_agentAddress_expiresAt_chainId_contractAddress_idx" ON "InfoFiAgentHeartbeat"("agentAddress", "expiresAt", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "InfoFiAgentHeartbeat_expiresAt_chainId_contractAddress_idx" ON "InfoFiAgentHeartbeat"("expiresAt", "chainId", "contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiAgentHeartbeat_signatureDigest_chainId_contractAddress_key" ON "InfoFiAgentHeartbeat"("signatureDigest", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "InfoFiAgentDecisionLog_agentAddress_createdAt_chainId_contractAddress_idx" ON "InfoFiAgentDecisionLog"("agentAddress", "createdAt", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "InfoFiAgentDecisionLog_requestId_chainId_contractAddress_idx" ON "InfoFiAgentDecisionLog"("requestId", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "InfoFiAgentDecisionLog_domain_createdAt_chainId_contractAddress_idx" ON "InfoFiAgentDecisionLog"("domain", "createdAt", "chainId", "contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiAgentAuthChallenge_nonce_key" ON "InfoFiAgentAuthChallenge"("nonce");

-- CreateIndex
CREATE INDEX "InfoFiAgentAuthChallenge_agentAddress_purpose_expiresAt_chainId_contractAddress_idx" ON "InfoFiAgentAuthChallenge"("agentAddress", "purpose", "expiresAt", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "InfoFiDomainDemandSignal_bucketStart_source_chainId_contractAddress_idx" ON "InfoFiDomainDemandSignal"("bucketStart", "source", "chainId", "contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiDomainDemandSignal_domain_bucketStart_source_chainId_contractAddress_key" ON "InfoFiDomainDemandSignal"("domain", "bucketStart", "source", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "InfoFiDomainDemandSignalClient_bucketStart_source_chainId_contractAddress_idx" ON "InfoFiDomainDemandSignalClient"("bucketStart", "source", "chainId", "contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "InfoFiDomainDemandSignalClient_domain_bucketStart_source_clientIdHash_chainId_contractAddress_key" ON "InfoFiDomainDemandSignalClient"("domain", "bucketStart", "source", "clientIdHash", "chainId", "contractAddress");

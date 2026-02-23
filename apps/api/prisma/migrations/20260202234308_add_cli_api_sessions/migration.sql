-- CreateTable
CREATE TABLE "ApiSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "githubAccessTokenEnc" TEXT NOT NULL,
    "userLogin" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "userAvatarUrl" TEXT,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GithubDeviceAuth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "verificationUri" TEXT NOT NULL,
    "interval" INTEGER NOT NULL,
    "scope" TEXT,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiSession_tokenHash_key" ON "ApiSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiSession_expiresAt_idx" ON "ApiSession"("expiresAt");

-- CreateIndex
CREATE INDEX "ApiSession_userLogin_idx" ON "ApiSession"("userLogin");

-- CreateIndex
CREATE UNIQUE INDEX "GithubDeviceAuth_deviceCodeHash_key" ON "GithubDeviceAuth"("deviceCodeHash");

-- CreateIndex
CREATE INDEX "GithubDeviceAuth_expiresAt_idx" ON "GithubDeviceAuth"("expiresAt");

-- CreateTable
CREATE TABLE "GithubSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accessToken" TEXT NOT NULL,
    "userLogin" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "userAvatarUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "GithubSession_expiresAt_idx" ON "GithubSession"("expiresAt");

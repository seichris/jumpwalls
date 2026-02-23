-- CreateTable
CREATE TABLE "LinkedPullRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "author" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkedPullRequest_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty" ("bountyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedPullRequest_bountyId_prUrl_key" ON "LinkedPullRequest"("bountyId", "prUrl");

/*
  Warnings:

  - You are about to drop the `TreasuryBountyLedger` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TreasuryFundingIntent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TreasuryPayoutIntent` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "TreasuryBountyLedger";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "TreasuryFundingIntent";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "TreasuryPayoutIntent";
PRAGMA foreign_keys=on;

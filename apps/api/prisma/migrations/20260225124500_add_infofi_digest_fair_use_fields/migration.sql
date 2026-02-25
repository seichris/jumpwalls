-- AlterTable
ALTER TABLE "InfoFiDigest" ADD COLUMN "fairUseVerdict" TEXT;
ALTER TABLE "InfoFiDigest" ADD COLUMN "fairUseRiskLevel" TEXT;
ALTER TABLE "InfoFiDigest" ADD COLUMN "fairUseScore" INTEGER;
ALTER TABLE "InfoFiDigest" ADD COLUMN "fairUsePolicyVersion" TEXT;
ALTER TABLE "InfoFiDigest" ADD COLUMN "fairUseReportJson" TEXT;

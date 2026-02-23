// Import from /src so both tsx (dev) and dist/ runtime can resolve without copying generated files.
import { PrismaClient } from "../src/generated/prisma/index.js";

let prisma: PrismaClient | null = null;

export function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

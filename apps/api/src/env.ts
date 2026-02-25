import { z } from "zod";
import dotenv from "dotenv";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).default("file:./prisma/dev-infofi.db"),
  RPC_URL: z.string().optional().or(z.literal("")).default(""),
  RPC_URLS_ETHEREUM_MAINNET: z.string().optional().or(z.literal("")).default(""),
  RPC_URLS_ETHEREUM_SEPOLIA: z.string().optional().or(z.literal("")).default(""),
  RPC_URLS_BASE_MAINNET: z.string().optional().or(z.literal("")).default(""),
  RPC_URL_ETHEREUM_MAINNET: z.string().optional().or(z.literal("")).default(""),
  RPC_URL_ETHEREUM_SEPOLIA: z.string().optional().or(z.literal("")).default(""),
  RPC_URL_BASE_MAINNET: z.string().optional().or(z.literal("")).default(""),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  CONTRACT_KIND: z
    .preprocess((value) => (typeof value === "string" ? value.toLowerCase() : value), z.literal("infofi"))
    .optional()
    .default("infofi"),
  CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional()
    .or(z.literal("")),
  API_ORIGIN: z.string().optional().or(z.literal("")),
  WEB_ORIGIN: z.string().optional().or(z.literal("")),
  INDEXER_BACKFILL_BLOCK_CHUNK: z.coerce.number().int().min(1).default(10),
  INDEXER_START_BLOCK: z
    .preprocess((value) => (value === "" || value == null ? undefined : value), z.coerce.number().int().min(0))
    .optional(),
  PORT: z.coerce.number().int().positive().default(8787)
});

type ParsedEnv = z.infer<typeof EnvSchema>;

export type Env = ParsedEnv & { RPC_URLS: string[] };

function sanitizeRpcUrl(input: string) {
  let url = input.trim();
  if (!url) return "";
  url = url.replace(/^['"`]+/, "").replace(/['"`]+$/, "").trim();
  url = url.replace(/^(https?):\/(?!\/)/i, "$1://");
  return url;
}

function parseRpcUrls(value: string | undefined) {
  const raw = (value || "").trim();
  if (!raw) return [];

  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((v) => sanitizeRpcUrl(String(v))).filter(Boolean);
      }
    } catch {
      // fall through to comma-separated parsing
    }
  }

  return raw
    .split(",")
    .map((url) => sanitizeRpcUrl(url))
    .filter(Boolean);
}

function dedupeRpcUrls(urls: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawUrl of urls) {
    const url = sanitizeRpcUrl(rawUrl);
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export function loadEnv(): Env {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  const env = parsed.data;

  const explicitRpcUrls = parseRpcUrls(env.RPC_URL);
  let chainRpcUrls: string[] = [];
  if (env.CHAIN_ID === 1) {
    chainRpcUrls = parseRpcUrls(env.RPC_URLS_ETHEREUM_MAINNET);
    if (chainRpcUrls.length === 0) chainRpcUrls = parseRpcUrls(env.RPC_URL_ETHEREUM_MAINNET);
  } else if (env.CHAIN_ID === 8453) {
    chainRpcUrls = parseRpcUrls(env.RPC_URLS_BASE_MAINNET);
    if (chainRpcUrls.length === 0) chainRpcUrls = parseRpcUrls(env.RPC_URL_BASE_MAINNET);
  } else if (env.CHAIN_ID === 11155111) {
    chainRpcUrls = parseRpcUrls(env.RPC_URLS_ETHEREUM_SEPOLIA);
    if (chainRpcUrls.length === 0) chainRpcUrls = parseRpcUrls(env.RPC_URL_ETHEREUM_SEPOLIA);
  }

  const rpcUrls = dedupeRpcUrls([...explicitRpcUrls, ...chainRpcUrls]);
  const rpcUrl = rpcUrls[0] || "";

  return { ...env, RPC_URL: rpcUrl, RPC_URLS: rpcUrls };
}

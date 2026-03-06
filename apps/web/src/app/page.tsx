"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Moon, RefreshCw, Sun } from "lucide-react";

import { AccountRailControls } from "@/components/infofi/account-rail-controls";
import { BrandLockIcon } from "@/components/infofi/brand-lock-icon";
import { PostRequestDialog } from "@/components/infofi/post-request-dialog";
import { RailBadge } from "@/components/infofi/rail-badge";
import { useUserRail } from "@/components/providers/user-rail-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAgentIdentity, getDomainPresence, getRequests } from "@/lib/api";
import { formatAmount, tokenSymbol } from "@/lib/infofi-contract";
import type { InfoFiDomainPresenceRow, InfoFiRequest } from "@/lib/infofi-types";
import { useTheme } from "@/lib/hooks/useTheme";
import { useWallet } from "@/lib/hooks/useWallet";
import { etaMinutesLabel } from "@/lib/presence";
import { isPrivyFeatureEnabled } from "@/lib/privy";
import { errorMessage } from "@/lib/utils";

function shortHash(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function sourceHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    const trimmed = url.trim();
    const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    return withoutScheme.replace(/^www\./i, "").split(/[/?#]/)[0] || trimmed;
  }
}

function sourceFaviconUrls(url: string) {
  const domain = normalizeDomain(url);
  if (!domain) return [];
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
  ];
}

function normalizeDomain(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const asUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(asUrl).hostname.trim().toLowerCase();
    return host.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#:]/)[0]
      .replace(/\.$/, "");
  }
}

function statusVariant(status: string): "default" | "secondary" | "warning" | "success" {
  const upper = status.toUpperCase();
  if (upper === "OPEN") return "success";
  if (upper === "HIRED") return "warning";
  if (upper === "CLOSED") return "default";
  return "secondary";
}

type AgentRuntimeKind =
  | "openclaw"
  | "kimiclaw"
  | "ironclaw"
  | "claude"
  | "gpt"
  | "gemini"
  | "deepseek"
  | "qwen"
  | "mistral"
  | "llama"
  | "grok"
  | "copilot"
  | "perplexity"
  | "openai"
  | "cursor"
  | "agent";

const RUNTIME_PRIORITY: AgentRuntimeKind[] = [
  "openclaw",
  "kimiclaw",
  "ironclaw",
  "claude",
  "gpt",
  "gemini",
  "deepseek",
  "qwen",
  "mistral",
  "llama",
  "grok",
  "copilot",
  "perplexity",
  "openai",
  "cursor",
  "agent",
];

const RUNTIME_BADGE_META: Record<AgentRuntimeKind, { label: string; title: string }> = {
  openclaw: {
    label: "OC",
    title: "OpenClaw",
  },
  kimiclaw: {
    label: "KC",
    title: "KimiClaw",
  },
  ironclaw: {
    label: "IC",
    title: "IronClaw",
  },
  claude: {
    label: "CL",
    title: "Claude",
  },
  gpt: {
    label: "GPT",
    title: "GPT",
  },
  gemini: {
    label: "GM",
    title: "Gemini",
  },
  deepseek: {
    label: "DS",
    title: "DeepSeek",
  },
  qwen: {
    label: "QW",
    title: "Qwen",
  },
  mistral: {
    label: "MS",
    title: "Mistral",
  },
  llama: {
    label: "LL",
    title: "Llama",
  },
  grok: {
    label: "GR",
    title: "Grok",
  },
  copilot: {
    label: "CP",
    title: "Copilot",
  },
  perplexity: {
    label: "PX",
    title: "Perplexity",
  },
  openai: {
    label: "OA",
    title: "OpenAI",
  },
  cursor: {
    label: "CU",
    title: "Cursor",
  },
  agent: {
    label: "AI",
    title: "Agent",
  },
};

const RUNTIME_ICON_DOMAINS: Record<AgentRuntimeKind, string[]> = {
  openclaw: ["openclaw.ai"],
  kimiclaw: ["kimi.ai"],
  ironclaw: ["ironclaw.ai"],
  claude: ["claude.ai"],
  gpt: ["chatgpt.com", "openai.com"],
  gemini: ["gemini.google.com"],
  deepseek: ["chat.deepseek.com", "deepseek.com"],
  qwen: ["chat.qwen.ai", "qwen.ai"],
  mistral: ["chat.mistral.ai", "mistral.ai"],
  llama: ["ai.meta.com", "meta.ai"],
  grok: ["grok.com", "x.ai"],
  copilot: ["github.com", "copilot.microsoft.com"],
  perplexity: ["perplexity.ai"],
  openai: ["openai.com"],
  cursor: ["cursor.com"],
  agent: [],
};

function runtimeFaviconUrls(runtime: AgentRuntimeKind): string[] {
  const domains = RUNTIME_ICON_DOMAINS[runtime] ?? [];
  const urls: string[] = [];
  for (const domain of domains) {
    urls.push(`https://${domain}/favicon.ico`);
    urls.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`);
    urls.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`);
  }
  return Array.from(new Set(urls));
}

function RuntimeFavicon({
  runtime,
  className,
  title,
}: {
  runtime: AgentRuntimeKind | null | undefined;
  className: string;
  title?: string;
}) {
  const resolvedRuntime = runtime ?? "agent";
  const urls = React.useMemo(() => runtimeFaviconUrls(resolvedRuntime), [resolvedRuntime]);
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    setIndex(0);
  }, [resolvedRuntime]);

  const meta = RUNTIME_BADGE_META[resolvedRuntime];
  const ariaTitle = title || meta.title;

  if (urls.length === 0 || index >= urls.length) {
    return (
      <span
        title={ariaTitle}
        aria-label={ariaTitle}
        className={`inline-flex items-center justify-center rounded-full bg-muted text-[8px] font-semibold leading-none text-muted-foreground ${className}`}
      >
        {meta.label}
      </span>
    );
  }

  return (
    <img
      src={urls[index]}
      alt=""
      title={ariaTitle}
      aria-label={ariaTitle}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        setIndex((current) => current + 1);
      }}
    />
  );
}

function inferRuntime(version: string | null | undefined, displayName: string | null | undefined): AgentRuntimeKind | null {
  const raw = `${version ?? ""} ${displayName ?? ""}`.trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("openclaw")) return "openclaw";
  if (raw.includes("kimiclaw")) return "kimiclaw";
  if (raw.includes("ironclaw")) return "ironclaw";
  if (raw.includes("claude")) return "claude";
  if (raw.includes("gpt") || raw.includes("chatgpt")) return "gpt";
  if (raw.includes("gemini")) return "gemini";
  if (raw.includes("deepseek")) return "deepseek";
  if (raw.includes("qwen")) return "qwen";
  if (raw.includes("mistral")) return "mistral";
  if (raw.includes("meta-llama") || raw.includes("llama")) return "llama";
  if (raw.includes("grok") || raw.includes("xai")) return "grok";
  if (raw.includes("github-copilot") || raw.includes("copilot")) return "copilot";
  if (raw.includes("perplexity")) return "perplexity";
  if (
    raw.includes("openai") ||
    raw.includes("codex") ||
    raw.includes("gpt-4o") ||
    raw.includes("o1") ||
    raw.includes("o3")
  ) {
    return "openai";
  }
  if (raw.includes("cursor")) return "cursor";
  if (raw.includes("agent") || raw.includes("bot") || raw.includes("worker")) return "agent";
  return null;
}

function dominantRuntime(
  addresses: string[] | undefined,
  runtimeByAddress: Record<string, AgentRuntimeKind | null>
): AgentRuntimeKind | null {
  if (!addresses || addresses.length === 0) return null;
  const counts = new Map<AgentRuntimeKind, number>();
  for (const addr of addresses) {
    const runtime = runtimeByAddress[addr.toLowerCase()];
    if (!runtime) continue;
    counts.set(runtime, (counts.get(runtime) || 0) + 1);
  }
  if (counts.size === 0) return null;

  let winner: AgentRuntimeKind | null = null;
  let winnerCount = -1;
  for (const runtime of RUNTIME_PRIORITY) {
    const count = counts.get(runtime) || 0;
    if (count > winnerCount) {
      winner = runtime;
      winnerCount = count;
    }
  }
  return winner;
}

function SourceFavicon({
  source,
  className,
  showFallback = false,
  runtime,
}: {
  source: string;
  className: string;
  showFallback?: boolean;
  runtime?: AgentRuntimeKind | null;
}) {
  const urls = React.useMemo(() => sourceFaviconUrls(source), [source]);
  const [index, setIndex] = React.useState(0);
  const runtimeBadgeTitle = runtime ? RUNTIME_BADGE_META[runtime].title : null;

  React.useEffect(() => {
    setIndex(0);
  }, [source]);

  if (urls.length === 0 || index >= urls.length) {
    if (!showFallback && !runtime) return null;
    return (
      <span className="relative inline-flex">
        {showFallback ? <span className="text-[10px]">?</span> : null}
        {runtime ? (
          <span className="absolute -bottom-2 -right-2 inline-flex size-5 items-center justify-center">
            <RuntimeFavicon runtime={runtime} className="size-full rounded-full" title={runtimeBadgeTitle || undefined} />
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="relative inline-flex">
      <img
        src={urls[index]}
        alt=""
        className={className}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={(event) => {
          if (index !== 0) return;
          if (event.currentTarget.naturalWidth <= 16 && event.currentTarget.naturalHeight <= 16) {
            setIndex((current) => current + 1);
          }
        }}
        onError={() => {
          setIndex((current) => current + 1);
        }}
      />
      {runtime ? (
        <span className="absolute -bottom-2 -right-2 inline-flex size-5 items-center justify-center">
          <RuntimeFavicon runtime={runtime} className="size-full rounded-full" title={runtimeBadgeTitle || undefined} />
        </span>
      ) : null}
    </span>
  );
}

export default function HomePage() {
  const router = useRouter();
  const expectedChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "8453");
  const { activeRail } = useUserRail();
  const { address, chainId, hasProvider, setProviderPreference, connect, switchChain } = useWallet();
  const { theme, setTheme, mounted } = useTheme();
  const privyEnabled = isPrivyFeatureEnabled();

  const [requests, setRequests] = React.useState<InfoFiRequest[]>([]);
  const [domainPresenceByDomain, setDomainPresenceByDomain] = React.useState<Record<string, InfoFiDomainPresenceRow>>({});
  const [agentRuntimeByAddress, setAgentRuntimeByAddress] = React.useState<Record<string, AgentRuntimeKind | null>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [openPostRequest, setOpenPostRequest] = React.useState(false);
  const [postRequestSourceHint, setPostRequestSourceHint] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [tokenFilter, setTokenFilter] = React.useState("ALL");
  const [requesterFilter, setRequesterFilter] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState("");

  const wrongChain = chainId !== null && chainId !== expectedChainId;
  const postRequestBlockedByChain = activeRail === "BASE" && wrongChain;

  React.useEffect(() => {
    if (!privyEnabled) return;
    setProviderPreference("bridged");
  }, [privyEnabled, setProviderPreference]);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, domainPresence] = await Promise.all([
        getRequests({
          take: 500,
          status: statusFilter === "ALL" ? undefined : statusFilter,
        }),
        getDomainPresence({ take: 500, minActiveAgents: 0 }),
      ]);
      setRequests(rows);
      const byDomain = domainPresence.reduce<Record<string, InfoFiDomainPresenceRow>>((acc, row) => {
        acc[row.domain] = row;
        return acc;
      }, {});
      setDomainPresenceByDomain(byDomain);

      const uniqueAgentAddresses = Array.from(
        new Set(
          domainPresence
            .flatMap((row) => row.activeAgentAddresses)
            .map((entry) => entry.toLowerCase())
            .filter(Boolean)
        )
      );

      if (uniqueAgentAddresses.length === 0) {
        setAgentRuntimeByAddress({});
      } else {
        const identities = await Promise.all(
          uniqueAgentAddresses.map(async (agentAddress) => {
            try {
              return await getAgentIdentity(agentAddress);
            } catch {
              return null;
            }
          })
        );
        const byAddress: Record<string, AgentRuntimeKind | null> = {};
        for (const agentAddress of uniqueAgentAddresses) {
          byAddress[agentAddress] = null;
        }
        for (const identity of identities) {
          if (!identity) continue;
          byAddress[identity.agentAddress.toLowerCase()] = inferRuntime(identity.clientVersion, identity.displayName);
        }
        setAgentRuntimeByAddress(byAddress);
      }
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  React.useEffect(() => {
    fetchData().catch(() => {});
  }, [fetchData]);

  const filtered = React.useMemo(() => {
    return requests.filter((row) => {
      if (requesterFilter.trim()) {
        const q = requesterFilter.trim().toLowerCase();
        if (!row.requester.toLowerCase().includes(q)) return false;
      }
      if (tokenFilter !== "ALL" && tokenSymbol(row.paymentToken) !== tokenFilter) return false;
      if (sourceFilter.trim()) {
        const q = sourceFilter.trim().toLowerCase();
        if (!row.sourceURI.toLowerCase().includes(q) && !sourceHost(row.sourceURI).toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [requests, requesterFilter, tokenFilter, sourceFilter]);

  const liveDomains = React.useMemo(() => {
    return Object.values(domainPresenceByDomain)
      .filter((row) => row.activeAgents > 0)
      .sort(
        (left, right) =>
          right.activeAgents - left.activeAgents ||
          (left.medianExpectedEtaSeconds ?? Number.POSITIVE_INFINITY) - (right.medianExpectedEtaSeconds ?? Number.POSITIVE_INFINITY) ||
          left.domain.localeCompare(right.domain)
      );
  }, [domainPresenceByDomain]);

  const openPostRequestDialog = React.useCallback((sourceHint: string) => {
    setPostRequestSourceHint(sourceHint);
    setOpenPostRequest(true);
  }, []);

  return (
    <main className="mx-auto w-full px-4 py-6 md:px-8">
      <header className="mb-6 flex flex-col gap-4 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrandLockIcon className="size-7" />
            <h1 className="text-3xl font-semibold tracking-tight">Jump Walls!</h1>
          </div>
          {/*
          <p className="text-sm text-muted-foreground">
            A marketplace for paywalled content. Fair use only! Agents start at{" "}
            <a
              href="https://github.com/seichris/jumpwalls/blob/main/AGENTS.md"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              AGENTS.md
            </a>
            .
          </p>
          */}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {privyEnabled ? (
            <AccountRailControls expectedChainId={expectedChainId} walletAddress={address} walletChainId={chainId} />
          ) : null}
          {!privyEnabled && !hasProvider ? <Badge variant="warning">No Wallet Provider</Badge> : null}
          {!privyEnabled && hasProvider && !address ? <Button onClick={() => connect()}>Connect Wallet</Button> : null}
          {activeRail === "BASE" && wrongChain ? (
            <Button variant="destructive" onClick={() => switchChain(expectedChainId)}>
              Switch to Base Chain
            </Button>
          ) : null}
          <Button onClick={() => openPostRequestDialog("")} disabled={!address || postRequestBlockedByChain}>
            Post Request
          </Button>
          <Button variant="outline" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} disabled={!mounted}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" onClick={() => fetchData()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <section className="mb-4 rounded-lg">
        <p className="text-sm">
          This is a platform for humans and AI agents to request paywalled content and earn bounties delivering it.
        </p>
        <p className="mt-1 text-sm">
          Choose from available Requests or list your agent to serve content from any platform, by following this{" "}
          <a
            href="https://github.com/seichris/jumpwalls/blob/main/AGENTS.md"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            AGENTS.md
          </a>
          .
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Live Agents:</p>
        {loading ? (
          <p className="mt-3 text-xs text-muted-foreground">Loading offer-ready agents...</p>
        ) : liveDomains.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">No offer-ready agents online right now.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-3">
            {liveDomains.map((row) => {
              const sourceDisplay = sourceHost(row.domain);
              const runtime = dominantRuntime(row.activeAgentAddresses, agentRuntimeByAddress);
              return (
                <button
                  type="button"
                  key={row.domain}
                  className="inline-flex size-6 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  title={sourceDisplay}
                  onClick={() => openPostRequestDialog(`https://${row.domain}`)}
                  disabled={!address || postRequestBlockedByChain}
                >
                  <SourceFavicon source={row.domain} className="size-6 rounded-sm" showFallback runtime={runtime} />
                  <span className="sr-only">{sourceDisplay}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-4 grid gap-2 md:grid-cols-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="HIRED">Hired</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={tokenFilter} onValueChange={setTokenFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Token" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All tokens</SelectItem>
            <SelectItem value="ETH">ETH</SelectItem>
            <SelectItem value="USDC">USDC</SelectItem>
            <SelectItem value="SETUSDC">SETUSDC</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Filter by requester address"
          value={requesterFilter}
          onChange={(event) => setRequesterFilter(event.target.value)}
        />

        <Input
          placeholder="Filter by source URL/domain"
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
        />
      </section>

      {error ? <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <section className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Request</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Question</TableHead>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Max Amount</TableHead>
              <TableHead className="text-right">Active Agents</TableHead>
              <TableHead className="text-right">ETA</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  Loading requests...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  No requests found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const requestDomain = normalizeDomain(row.sourceURI);
                const presence = requestDomain ? domainPresenceByDomain[requestDomain] : undefined;
                const activeAgents = presence?.activeAgents ?? 0;
                const activeAgentAddresses = presence?.activeAgentAddresses ?? [];
                const sourceDisplay = sourceHost(row.sourceURI);
                return (
                  <TableRow
                    key={row.requestId}
                    className="cursor-pointer"
                    onClick={() => router.push(`/request/${row.requestId}`)}
                  >
                    <TableCell className="font-mono text-xs">
                      <Link className="hover:underline" href={`/request/${row.requestId}`} onClick={(event) => event.stopPropagation()}>
                        {shortHash(row.requestId)}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="flex min-w-0 items-center gap-2">
                        <SourceFavicon source={row.sourceURI} className="size-4 shrink-0 rounded-sm" />
                        <span className="truncate">{sourceDisplay}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate">{row.question}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <RailBadge rail={row.rail} />
                        <span>{tokenSymbol(row.paymentToken)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatAmount(row.paymentToken, row.maxAmountWei)}
                    </TableCell>
                    <TableCell className="text-right">
                      {activeAgents > 0 ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          <span className="font-mono text-xs">{activeAgents}</span>
                          <span className="inline-flex items-center -space-x-1">
                            {activeAgentAddresses.slice(0, 4).map((agentAddress) => {
                              const normalizedAgentAddress = agentAddress.toLowerCase();
                              const runtime = agentRuntimeByAddress[normalizedAgentAddress] ?? null;
                              const title = `${runtime ? RUNTIME_BADGE_META[runtime].title : "Agent"} ${shortHash(agentAddress)}`;
                              return (
                                <span
                                  key={agentAddress}
                                  className="inline-flex size-4 items-center justify-center"
                                >
                                  <RuntimeFavicon runtime={runtime} className="size-full rounded-full" title={title} />
                                </span>
                              );
                            })}
                          </span>
                          {activeAgentAddresses.length > 4 ? (
                            <span className="text-[10px] text-muted-foreground">+{activeAgentAddresses.length - 4}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="font-mono text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">{etaMinutesLabel(presence?.medianExpectedEtaSeconds ?? null)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.updatedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </section>

      <PostRequestDialog
        open={openPostRequest}
        onOpenChange={setOpenPostRequest}
        walletAddress={address}
        initialSourceURI={postRequestSourceHint}
        onCreated={(requestId) => {
          router.push(`/request/${requestId}`);
        }}
      />
    </main>
  );
}

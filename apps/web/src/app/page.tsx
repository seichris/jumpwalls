"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Moon, RefreshCw, Sun } from "lucide-react";

import { BrandLockIcon } from "@/components/infofi/brand-lock-icon";
import { PostRequestDialog } from "@/components/infofi/post-request-dialog";
import { PrivyConnectWalletButton } from "@/components/infofi/privy-connect-wallet-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDomainPresence, getRequests } from "@/lib/api";
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

function SourceFavicon({
  source,
  className,
  showFallback = false,
}: {
  source: string;
  className: string;
  showFallback?: boolean;
}) {
  const urls = React.useMemo(() => sourceFaviconUrls(source), [source]);
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    setIndex(0);
  }, [source]);

  if (urls.length === 0 || index >= urls.length) {
    return showFallback ? <span className="text-[10px]">?</span> : null;
  }

  return (
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
  );
}

export default function HomePage() {
  const router = useRouter();
  const expectedChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "8453");
  const { address, chainId, hasProvider, setProviderPreference, connect, switchChain } = useWallet();
  const { theme, setTheme, mounted } = useTheme();
  const privyEnabled = isPrivyFeatureEnabled();

  const [requests, setRequests] = React.useState<InfoFiRequest[]>([]);
  const [domainPresenceByDomain, setDomainPresenceByDomain] = React.useState<Record<string, InfoFiDomainPresenceRow>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [openPostRequest, setOpenPostRequest] = React.useState(false);
  const [postRequestSourceHint, setPostRequestSourceHint] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [tokenFilter, setTokenFilter] = React.useState("ALL");
  const [requesterFilter, setRequesterFilter] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState("");

  const wrongChain = chainId !== null && chainId !== expectedChainId;

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
            <PrivyConnectWalletButton expectedChainId={expectedChainId} walletAddress={address} walletChainId={chainId} />
          ) : null}
          {!privyEnabled && !hasProvider ? <Badge variant="warning">No Wallet Provider</Badge> : null}
          {!privyEnabled && hasProvider && !address ? <Button onClick={() => connect()}>Connect Wallet</Button> : null}
          {wrongChain ? (
            <Button variant="destructive" onClick={() => switchChain(expectedChainId)}>
              Switch to Base Chain
            </Button>
          ) : null}

          <Button onClick={() => openPostRequestDialog("")} disabled={!address || wrongChain}>
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
          <div className="mt-3 flex flex-wrap gap-2">
            {liveDomains.map((row) => {
              const sourceDisplay = sourceHost(row.domain);
              return (
                <Button
                  key={row.domain}
                  size="icon"
                  variant="outline"
                  className="size-9"
                  title={sourceDisplay}
                  onClick={() => openPostRequestDialog(`https://${row.domain}`)}
                  disabled={!address || wrongChain}
                >
                  <SourceFavicon source={row.domain} className="size-5 rounded-sm" showFallback />
                  <span className="sr-only">{sourceDisplay}</span>
                </Button>
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
                    <TableCell>{tokenSymbol(row.paymentToken)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatAmount(row.paymentToken, row.maxAmountWei)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{activeAgents > 0 ? activeAgents : "—"}</TableCell>
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

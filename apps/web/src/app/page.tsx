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
    return new URL(url).host;
  } catch {
    return url;
  }
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

  return (
    <main className="mx-auto w-full px-4 py-6 md:px-8">
      <header className="mb-6 flex flex-col gap-4 border-b pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrandLockIcon className="size-7" />
            <h1 className="text-3xl font-semibold tracking-tight">Jump Walls!</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            A marketplace for paywalled content. Fair use only! Agents start at{" "}
            <a
              href="https://github.com/seichris/infofi/blob/main/AGENTS.md"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              AGENTS.md
            </a>
            .
          </p>
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

          <Button onClick={() => setOpenPostRequest(true)} disabled={!address || wrongChain}>
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
                    <TableCell className="max-w-[220px] truncate">{sourceHost(row.sourceURI)}</TableCell>
                    <TableCell className="max-w-[360px] truncate">{row.question}</TableCell>
                    <TableCell>{tokenSymbol(row.paymentToken)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatAmount(row.paymentToken, row.maxAmountWei)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{presence?.activeAgents ?? 0}</TableCell>
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
        onCreated={(requestId) => {
          router.push(`/request/${requestId}`);
        }}
      />
    </main>
  );
}

import { apiOriginForDisplay, apiOriginPermissionPattern, normalizeApiUrl } from "./api";
import { DEFAULT_SETTINGS, EMPTY_STATE } from "./constants";
import { extractDomainFromSource, normalizeDomain } from "./domain";
import { getSettings } from "./storage";
import type { BackgroundStateResponse, ExtensionSettings } from "./types";

const settingsForm = document.getElementById("settings-form") as HTMLFormElement;
const apiUrlInput = document.getElementById("api-url-input") as HTMLInputElement;
const historyLookbackInput = document.getElementById("history-lookback-input") as HTMLInputElement;
const subscriptionDomainList = document.getElementById("subscription-domain-list") as HTMLUListElement;
const contractLabel = document.getElementById("contract-label") as HTMLParagraphElement;
const apiStatusLabel = document.getElementById("settings-api-label") as HTMLParagraphElement;
const settingsResult = document.getElementById("settings-result") as HTMLPreElement;

let latestSettings: ExtensionSettings = DEFAULT_SETTINGS;

function showResult(text: string, isError = false): void {
  settingsResult.classList.remove("hidden");
  settingsResult.classList.toggle("error", isError);
  settingsResult.textContent = text;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

function collectKnownDomains(settings: ExtensionSettings, background: BackgroundStateResponse): string[] {
  const domains = new Set<string>();

  for (const request of background.state.openRequests) {
    const domain = extractDomainFromSource(request.sourceURI);
    if (!domain) continue;
    domains.add(domain);
  }

  for (const domain of Object.keys(settings.subscriptionByDomain)) {
    const normalized = normalizeDomain(domain);
    if (!normalized) continue;
    domains.add(normalized);
  }

  return Array.from(domains).sort((left, right) => left.localeCompare(right));
}

function renderSubscriptionDomains(settings: ExtensionSettings, background: BackgroundStateResponse): void {
  subscriptionDomainList.replaceChildren();

  const domains = collectKnownDomains(settings, background);
  if (domains.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No request domains available yet. Refresh after open requests load.";
    subscriptionDomainList.appendChild(item);
    return;
  }

  const matchedRequestCountByDomain: Record<string, number> = {};
  for (const request of background.state.openRequests) {
    if (!background.state.matchedByRequestId[request.requestId]) continue;
    const domain = extractDomainFromSource(request.sourceURI);
    if (!domain) continue;
    matchedRequestCountByDomain[domain] = (matchedRequestCountByDomain[domain] || 0) + 1;
  }

  for (const domain of domains) {
    const item = document.createElement("li");
    item.classList.add("domain-preference-item");

    const info = document.createElement("div");
    info.classList.add("domain-preference-info");

    const domainLabel = document.createElement("p");
    domainLabel.classList.add("mono");
    domainLabel.textContent = domain;

    const domainSummary = document.createElement("p");
    domainSummary.classList.add("subtle", "domain-preference-summary");
    const matchedCount = matchedRequestCountByDomain[domain] || 0;
    domainSummary.textContent =
      matchedCount > 0
        ? `${matchedCount} matched open request${matchedCount === 1 ? "" : "s"}`
        : "No matched open requests";

    info.append(domainLabel, domainSummary);

    const toggle = document.createElement("label");
    toggle.classList.add("checkbox", "domain-preference-toggle");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(settings.subscriptionByDomain[domain]);
    input.setAttribute("data-subscription-domain", domain);
    const copy = document.createElement("span");
    copy.textContent = "I have a subscription";
    toggle.append(input, copy);

    item.append(info, toggle);
    subscriptionDomainList.appendChild(item);
  }
}

function readSubscriptionByDomain(): Record<string, boolean> {
  const inputs = subscriptionDomainList.querySelectorAll<HTMLInputElement>("input[data-subscription-domain]");
  if (inputs.length === 0) return { ...latestSettings.subscriptionByDomain };

  const subscriptionByDomain: Record<string, boolean> = {};
  inputs.forEach((input) => {
    const domain = normalizeDomain(input.getAttribute("data-subscription-domain") || "");
    if (!domain) return;
    subscriptionByDomain[domain] = input.checked;
  });
  return subscriptionByDomain;
}

async function loadState(): Promise<void> {
  const [settings, background] = await Promise.all([
    getSettings(),
    chrome.runtime.sendMessage({ type: "INFOFI_GET_STATE" }) as Promise<BackgroundStateResponse>
  ]);
  latestSettings = settings;
  apiUrlInput.value = settings.apiUrl;
  historyLookbackInput.value = String(settings.historyLookbackDays);
  if (background.state.contract) {
    contractLabel.textContent = `Chain ${background.state.contract.chainId} • Contract ${background.state.contract.contractAddress}`;
  } else {
    contractLabel.textContent = background.state.error || "Contract info unavailable";
  }
  apiStatusLabel.textContent = `API ${settings.apiUrl}`;
  renderSubscriptionDomains(settings, background);
}

async function ensureHistoryPermission(): Promise<void> {
  const granted = await chrome.permissions.request({ permissions: ["history"] });
  if (!granted) throw new Error("History permission is required for offer matching");
}

async function ensureApiOriginPermission(apiUrl: string): Promise<void> {
  const originPattern = apiOriginPermissionPattern(apiUrl);
  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (hasPermission) return;

  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (!granted) throw new Error(`Permission is required to access API origin ${apiOriginForDisplay(apiUrl)}`);
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const apiUrl = normalizeApiUrl(apiUrlInput.value);
      const historyLookbackDays = Number.parseInt(historyLookbackInput.value || "", 10);
      if (!apiUrl) throw new Error("API URL is required");
      if (!Number.isFinite(historyLookbackDays) || historyLookbackDays < 1 || historyLookbackDays > 365) {
        throw new Error("History lookback must be between 1 and 365 days");
      }

      await ensureApiOriginPermission(apiUrl);
      await ensureHistoryPermission();

      const settings: ExtensionSettings = {
        apiUrl,
        historyLookbackDays,
        subscriptionByDomain: readSubscriptionByDomain()
      };
      const refreshed = (await chrome.runtime.sendMessage({
        type: "INFOFI_SET_SETTINGS",
        settings
      })) as BackgroundStateResponse;

      latestSettings = settings;
      showResult(`Saved. ${Object.keys(refreshed.state.matchedByRequestId).length} matched requests.`);
      contractLabel.textContent = refreshed.state.contract
        ? `Chain ${refreshed.state.contract.chainId} • Contract ${refreshed.state.contract.contractAddress}`
        : refreshed.state.error || "Contract info unavailable";
      apiStatusLabel.textContent = `API ${settings.apiUrl}`;
      renderSubscriptionDomains(settings, refreshed);
    } catch (error) {
      showResult(toErrorMessage(error), true);
    }
  })();
});

void loadState().catch(() => {
  apiUrlInput.value = DEFAULT_SETTINGS.apiUrl;
  historyLookbackInput.value = String(DEFAULT_SETTINGS.historyLookbackDays);
  latestSettings = DEFAULT_SETTINGS;
  renderSubscriptionDomains(DEFAULT_SETTINGS, {
    settings: DEFAULT_SETTINGS,
    state: EMPTY_STATE
  });
  apiStatusLabel.textContent = `API ${DEFAULT_SETTINGS.apiUrl}`;
});

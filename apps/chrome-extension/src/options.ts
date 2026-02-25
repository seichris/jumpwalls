import { normalizeApiUrl } from "./api";
import { DEFAULT_SETTINGS } from "./constants";
import { getSettings } from "./storage";
import type { BackgroundStateResponse, ExtensionSettings } from "./types";

const settingsForm = document.getElementById("settings-form") as HTMLFormElement;
const apiUrlInput = document.getElementById("api-url-input") as HTMLInputElement;
const historyEnabledInput = document.getElementById("history-enabled-input") as HTMLInputElement;
const historyLookbackInput = document.getElementById("history-lookback-input") as HTMLInputElement;
const contractLabel = document.getElementById("contract-label") as HTMLParagraphElement;
const apiStatusLabel = document.getElementById("settings-api-label") as HTMLParagraphElement;
const settingsResult = document.getElementById("settings-result") as HTMLPreElement;

function showResult(text: string, isError = false): void {
  settingsResult.classList.remove("hidden");
  settingsResult.classList.toggle("error", isError);
  settingsResult.textContent = text;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

async function loadState(): Promise<void> {
  const [settings, background] = await Promise.all([
    getSettings(),
    chrome.runtime.sendMessage({ type: "INFOFI_GET_STATE" }) as Promise<BackgroundStateResponse>
  ]);
  apiUrlInput.value = settings.apiUrl;
  historyEnabledInput.checked = settings.historyMatchingEnabled;
  historyLookbackInput.value = String(settings.historyLookbackDays);
  if (background.state.contract) {
    contractLabel.textContent = `Chain ${background.state.contract.chainId} • Contract ${background.state.contract.contractAddress}`;
  } else {
    contractLabel.textContent = background.state.error || "Contract info unavailable";
  }
  apiStatusLabel.textContent = `API ${settings.apiUrl}`;
}

async function ensureHistoryPermission(enabled: boolean): Promise<void> {
  if (enabled) {
    const granted = await chrome.permissions.request({ permissions: ["history"] });
    if (!granted) throw new Error("History permission is required for offer matching");
    return;
  }
  const hadPermission = await chrome.permissions.contains({ permissions: ["history"] });
  if (hadPermission) {
    await chrome.permissions.remove({ permissions: ["history"] });
  }
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const apiUrl = normalizeApiUrl(apiUrlInput.value);
      const historyMatchingEnabled = historyEnabledInput.checked;
      const historyLookbackDays = Number.parseInt(historyLookbackInput.value || "", 10);
      if (!apiUrl) throw new Error("API URL is required");
      if (!Number.isFinite(historyLookbackDays) || historyLookbackDays < 1 || historyLookbackDays > 365) {
        throw new Error("History lookback must be between 1 and 365 days");
      }

      await ensureHistoryPermission(historyMatchingEnabled);

      const settings: ExtensionSettings = {
        apiUrl,
        historyMatchingEnabled,
        historyLookbackDays
      };
      const refreshed = (await chrome.runtime.sendMessage({
        type: "INFOFI_SET_SETTINGS",
        settings
      })) as BackgroundStateResponse;

      showResult(`Saved. ${Object.keys(refreshed.state.matchedByRequestId).length} matched requests.`);
      contractLabel.textContent = refreshed.state.contract
        ? `Chain ${refreshed.state.contract.chainId} • Contract ${refreshed.state.contract.contractAddress}`
        : refreshed.state.error || "Contract info unavailable";
      apiStatusLabel.textContent = `API ${settings.apiUrl}`;
    } catch (error) {
      showResult(toErrorMessage(error), true);
    }
  })();
});

void loadState().catch(() => {
  apiUrlInput.value = DEFAULT_SETTINGS.apiUrl;
  historyEnabledInput.checked = DEFAULT_SETTINGS.historyMatchingEnabled;
  historyLookbackInput.value = String(DEFAULT_SETTINGS.historyLookbackDays);
  apiStatusLabel.textContent = `API ${DEFAULT_SETTINGS.apiUrl}`;
});

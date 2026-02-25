import { encodeFunctionData, isAddress, isHex, type Hex } from "viem";
import { infoFiAbi, infoFiOfferId, infoFiRequestId } from "@infofi/shared";
import { NATIVE_TOKEN } from "./constants";
import { extractDomainFromSource } from "./domain";
import type { BackgroundStateResponse, EthereumBridgeResponse, OpenRequest } from "./types";

const tabRequesterButton = document.getElementById("tab-requester-btn") as HTMLButtonElement;
const tabOffererButton = document.getElementById("tab-offerer-btn") as HTMLButtonElement;
const tabRequesterPanel = document.getElementById("tab-requester") as HTMLElement;
const tabOffererPanel = document.getElementById("tab-offerer") as HTMLElement;
const refreshStateButton = document.getElementById("refresh-state-btn") as HTMLButtonElement;
const openOptionsLink = document.getElementById("open-options-link") as HTMLAnchorElement;

const postRequestForm = document.getElementById("post-request-form") as HTMLFormElement;
const sourceUriInput = document.getElementById("source-uri-input") as HTMLInputElement;
const questionInput = document.getElementById("question-input") as HTMLTextAreaElement;
const paymentTokenInput = document.getElementById("payment-token-input") as HTMLInputElement;
const maxAmountInput = document.getElementById("max-amount-input") as HTMLInputElement;
const requestSaltInput = document.getElementById("request-salt-input") as HTMLInputElement;
const requestResult = document.getElementById("request-result") as HTMLPreElement;

const matchSummary = document.getElementById("match-summary") as HTMLParagraphElement;
const openSummary = document.getElementById("open-summary") as HTMLParagraphElement;
const matchedList = document.getElementById("matched-list") as HTMLUListElement;

const postOfferForm = document.getElementById("post-offer-form") as HTMLFormElement;
const offerRequestSelect = document.getElementById("offer-request-id-select") as HTMLSelectElement;
const offerAmountInput = document.getElementById("offer-amount-input") as HTMLInputElement;
const offerEtaInput = document.getElementById("offer-eta-input") as HTMLInputElement;
const offerProofInput = document.getElementById("offer-proof-input") as HTMLInputElement;
const offerSaltInput = document.getElementById("offer-salt-input") as HTMLInputElement;
const offerResult = document.getElementById("offer-result") as HTMLPreElement;

let currentState: BackgroundStateResponse | null = null;

function showTab(kind: "requester" | "offerer"): void {
  const requester = kind === "requester";
  tabRequesterButton.classList.toggle("active", requester);
  tabOffererButton.classList.toggle("active", !requester);
  tabRequesterPanel.classList.toggle("active", requester);
  tabOffererPanel.classList.toggle("active", !requester);
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

function showResult(target: HTMLPreElement, payload: unknown, isError = false): void {
  target.classList.remove("hidden");
  target.classList.toggle("error", isError);
  target.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function toHexChainId(chainId: number): Hex {
  return `0x${chainId.toString(16)}` as Hex;
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) throw new Error("No active tab found");
  return activeTab;
}

async function sendEthereumBridgeRequest<T>(method: string, params: unknown[] = []): Promise<T> {
  const tab = await getActiveTab();
  const send = async (): Promise<EthereumBridgeResponse<T>> =>
    (await chrome.tabs.sendMessage(tab.id!, {
      type: "INFOFI_ETHEREUM_REQUEST",
      method,
      params
    })) as EthereumBridgeResponse<T>;

  let response: EthereumBridgeResponse<T>;
  try {
    response = await send();
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ["content.js"] });
    response = await send();
  }

  if (!response.ok) throw new Error(response.error || "Wallet request failed");
  return response.result as T;
}

async function ensureWalletChain(requiredChainId: number): Promise<number> {
  const currentChainIdHex = await sendEthereumBridgeRequest<string>("eth_chainId");
  const currentChainId = Number.parseInt(currentChainIdHex, 16);
  if (currentChainId === requiredChainId) return currentChainId;

  try {
    await sendEthereumBridgeRequest<null>("wallet_switchEthereumChain", [{ chainId: toHexChainId(requiredChainId) }]);
  } catch (error) {
    throw new Error(
      `Wallet is on chain ${currentChainId}. Failed to switch to required chain ${requiredChainId}: ${asErrorMessage(error)}`
    );
  }

  const switchedChainIdHex = await sendEthereumBridgeRequest<string>("eth_chainId");
  const switchedChainId = Number.parseInt(switchedChainIdHex, 16);
  if (switchedChainId !== requiredChainId) {
    throw new Error(`Wallet chain remained ${switchedChainId}; required ${requiredChainId}.`);
  }
  return switchedChainId;
}

async function loadBackgroundState(forceRefresh = false): Promise<BackgroundStateResponse> {
  const messageType = forceRefresh ? "INFOFI_REFRESH_STATE" : "INFOFI_GET_STATE";
  const response = (await chrome.runtime.sendMessage({ type: messageType })) as BackgroundStateResponse;
  currentState = response;
  return response;
}

function renderState(response: BackgroundStateResponse): void {
  const { settings, state } = response;
  const matchCount = Object.keys(state.matchedByRequestId).length;

  matchSummary.textContent = `Matched requests: ${matchCount}`;
  openSummary.textContent = `Open requests: ${state.openRequests.length}`;

  matchedList.replaceChildren();
  const matchedRequests = state.openRequests.filter((request) => state.matchedByRequestId[request.requestId]);
  if (matchedRequests.length === 0) {
    const item = document.createElement("li");
    item.textContent = settings.historyMatchingEnabled
      ? "No history/domain matches yet."
      : "Enable history matching in Settings to detect opportunities.";
    matchedList.appendChild(item);
  } else {
    for (const request of matchedRequests) {
      const match = state.matchedByRequestId[request.requestId];
      const domain = match?.domain || extractDomainFromSource(request.sourceURI) || "unknown";
      const item = document.createElement("li");
      item.textContent = `[${domain}] ${request.question}`;
      matchedList.appendChild(item);
    }
  }

  offerRequestSelect.replaceChildren();
  for (const request of state.openRequests) {
    const option = document.createElement("option");
    const domain = extractDomainFromSource(request.sourceURI) || "unknown-domain";
    const matchPrefix = state.matchedByRequestId[request.requestId] ? "● " : "";
    option.value = request.requestId;
    option.textContent = `${matchPrefix}${domain} • ${request.question.slice(0, 48)}`;
    offerRequestSelect.appendChild(option);
  }
}

async function prefillSourceFromActiveTab(): Promise<void> {
  if (sourceUriInput.value.trim()) return;
  try {
    const tab = await getActiveTab();
    if (!tab.url) return;
    if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://")) return;
    sourceUriInput.value = tab.url;
  } catch {
    return;
  }
}

function resolvePaymentToken(raw: string): Hex {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toUpperCase() === "ETH") return NATIVE_TOKEN as Hex;
  if (!isAddress(trimmed)) throw new Error("Payment token must be ETH or a valid token address");
  return trimmed.toLowerCase() as Hex;
}

function ensureStateAndContract(): BackgroundStateResponse {
  if (!currentState) throw new Error("Extension state is not loaded");
  if (!currentState.state.contract?.contractAddress) throw new Error("Contract is not configured in API /contract");
  return currentState;
}

function requireOfferRequestById(requestId: string): OpenRequest {
  const state = ensureStateAndContract();
  const request = state.state.openRequests.find((item) => item.requestId === requestId);
  if (!request) throw new Error("Selected request is no longer open");
  return request;
}

async function handlePostRequest(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  try {
    const state = ensureStateAndContract();
    const sourceURI = sourceUriInput.value.trim();
    const question = questionInput.value.trim();
    const paymentToken = resolvePaymentToken(paymentTokenInput.value);
    const maxAmountWei = maxAmountInput.value.trim();
    const salt = requestSaltInput.value.trim() || randomSalt();

    if (!sourceURI || !question || !maxAmountWei) throw new Error("Missing required requester fields");
    if (!/^\d+$/.test(maxAmountWei)) throw new Error("Max amount must be an integer in wei");
    if (!isHex(salt, { strict: true }) || salt.length !== 66) {
      throw new Error("Salt must be bytes32 hex (0x + 64 hex chars)");
    }

    const accounts = await sendEthereumBridgeRequest<string[]>("eth_requestAccounts");
    const account = accounts?.[0];
    if (!account || !isAddress(account)) throw new Error("Wallet did not provide an account");

    const connectedChainId = await ensureWalletChain(state.state.contract!.chainId);

    const data = encodeFunctionData({
      abi: infoFiAbi,
      functionName: "postRequest",
      args: [sourceURI, question, paymentToken, BigInt(maxAmountWei), salt as Hex]
    });
    const txHash = await sendEthereumBridgeRequest<string>("eth_sendTransaction", [
      { from: account, to: state.state.contract!.contractAddress, data }
    ]);
    const requestId = infoFiRequestId(account.toLowerCase() as Hex, sourceURI, question, salt as Hex);

    showResult(requestResult, {
      ok: true,
      chainId: connectedChainId,
      account: account.toLowerCase(),
      requestId,
      txHash,
      sourceURI,
      paymentToken,
      maxAmountWei,
      salt
    });
    questionInput.value = "";
    requestSaltInput.value = "";
    await loadBackgroundState(true).then(renderState);
  } catch (error) {
    showResult(requestResult, asErrorMessage(error), true);
  }
}

async function handlePostOffer(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  try {
    const state = ensureStateAndContract();
    const requestId = offerRequestSelect.value.trim();
    const amountWei = offerAmountInput.value.trim();
    const etaSecondsRaw = offerEtaInput.value.trim();
    const proofType = offerProofInput.value.trim();
    const salt = offerSaltInput.value.trim() || randomSalt();

    requireOfferRequestById(requestId);
    if (!/^\d+$/.test(amountWei)) throw new Error("Offer amount must be an integer in wei");
    if (!/^\d+$/.test(etaSecondsRaw)) throw new Error("ETA seconds must be a non-negative integer");
    if (!proofType) throw new Error("Proof type is required");
    if (!isHex(requestId, { strict: true }) || requestId.length !== 66) throw new Error("Invalid requestId");
    if (!isHex(salt, { strict: true }) || salt.length !== 66) throw new Error("Salt must be bytes32 hex");

    const accounts = await sendEthereumBridgeRequest<string[]>("eth_requestAccounts");
    const account = accounts?.[0];
    if (!account || !isAddress(account)) throw new Error("Wallet did not provide an account");

    const connectedChainId = await ensureWalletChain(state.state.contract!.chainId);

    const etaSeconds = BigInt(etaSecondsRaw);
    const data = encodeFunctionData({
      abi: infoFiAbi,
      functionName: "postOffer",
      args: [requestId as Hex, BigInt(amountWei), etaSeconds, proofType, salt as Hex]
    });
    const txHash = await sendEthereumBridgeRequest<string>("eth_sendTransaction", [
      { from: account, to: state.state.contract!.contractAddress, data }
    ]);
    const offerId = infoFiOfferId(requestId as Hex, account.toLowerCase() as Hex, BigInt(amountWei), Number(etaSeconds), salt as Hex);

    showResult(offerResult, {
      ok: true,
      chainId: connectedChainId,
      account: account.toLowerCase(),
      requestId,
      offerId,
      txHash,
      amountWei,
      etaSeconds: etaSeconds.toString(),
      proofType,
      salt
    });
    offerSaltInput.value = "";
    await loadBackgroundState(true).then(renderState);
  } catch (error) {
    showResult(offerResult, asErrorMessage(error), true);
  }
}

tabRequesterButton.addEventListener("click", () => showTab("requester"));
tabOffererButton.addEventListener("click", () => showTab("offerer"));
refreshStateButton.addEventListener("click", () => {
  void loadBackgroundState(true).then(renderState).catch((error) => showResult(offerResult, asErrorMessage(error), true));
});
openOptionsLink.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

postRequestForm.addEventListener("submit", (event) => {
  void handlePostRequest(event);
});

postOfferForm.addEventListener("submit", (event) => {
  void handlePostOffer(event);
});

void (async () => {
  await prefillSourceFromActiveTab();
  const state = await loadBackgroundState(false);
  renderState(state);
})();

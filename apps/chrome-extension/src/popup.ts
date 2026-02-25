import { encodeFunctionData, isAddress, isHex, parseEther, parseUnits, type Hex } from "viem";
import { infoFiAbi, infoFiOfferId, infoFiRequestId, usdcAddressForChainId } from "@infofi/shared";
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
const paymentTokenInput = document.getElementById("payment-token-input") as HTMLSelectElement;
const maxAmountLabel = document.getElementById("max-amount-label") as HTMLSpanElement;
const maxAmountInput = document.getElementById("max-amount-input") as HTMLInputElement;
const requestResult = document.getElementById("request-result") as HTMLPreElement;

const matchSummary = document.getElementById("match-summary") as HTMLParagraphElement;
const openSummary = document.getElementById("open-summary") as HTMLParagraphElement;
const matchedList = document.getElementById("matched-list") as HTMLUListElement;

const postOfferForm = document.getElementById("post-offer-form") as HTMLFormElement;
const offerRequestSelect = document.getElementById("offer-request-id-select") as HTMLSelectElement;
const offerRequestSelection = document.getElementById("offer-request-selection") as HTMLParagraphElement;
const offerCurrencyInput = document.getElementById("offer-currency-input") as HTMLSelectElement;
const offerAmountLabel = document.getElementById("offer-amount-label") as HTMLSpanElement;
const offerAmountInput = document.getElementById("offer-amount-input") as HTMLInputElement;
const offerEtaInput = document.getElementById("offer-eta-input") as HTMLInputElement;
const offerResult = document.getElementById("offer-result") as HTMLPreElement;

const DEFAULT_OFFER_PROOF_TYPE = "reputation-only";

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
  const { state } = response;
  const matchCount = Object.keys(state.matchedByRequestId).length;
  const previousSelectedRequestId = offerRequestSelect.value.trim();

  matchSummary.textContent = `Matched requests: ${matchCount}`;
  openSummary.textContent = `Open requests: ${state.openRequests.length}`;

  matchedList.replaceChildren();
  if (state.openRequests.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No open requests available.";
    matchedList.appendChild(item);
  }

  offerRequestSelect.replaceChildren();
  for (const request of state.openRequests) {
    const option = document.createElement("option");
    const domain = extractDomainFromSource(request.sourceURI) || "unknown-domain";
    const matchPrefix = state.matchedByRequestId[request.requestId] ? "● " : "";
    option.value = request.requestId;
    option.textContent = `${matchPrefix}${domain} • ${request.question.slice(0, 48)}`;
    offerRequestSelect.appendChild(option);

    const item = document.createElement("li");
    item.classList.add("selectable");
    item.setAttribute("data-request-id", request.requestId);
    item.textContent = `${matchPrefix}[${domain}] ${request.question}`;
    item.addEventListener("click", () => {
      offerRequestSelect.value = request.requestId;
      updateOfferRequestSelectionUi();
      syncOfferCurrencyWithSelectedRequest();
    });
    matchedList.appendChild(item);
  }
  if (previousSelectedRequestId && state.openRequests.some((request) => request.requestId === previousSelectedRequestId)) {
    offerRequestSelect.value = previousSelectedRequestId;
  } else if (state.openRequests[0]) {
    offerRequestSelect.value = state.openRequests[0].requestId;
  } else {
    offerRequestSelect.value = "";
  }
  syncOfferCurrencyWithSelectedRequest();
  updateOfferRequestSelectionUi();
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

function resolvePaymentMode(raw: string): "USDC" | "ETH" {
  return raw.toUpperCase() === "ETH" ? "ETH" : "USDC";
}

function paymentModeFromToken(token: string, chainId: number): "USDC" | "ETH" {
  const lower = token.toLowerCase();
  if (lower === NATIVE_TOKEN.toLowerCase()) return "ETH";
  const usdc = usdcAddressForChainId(chainId);
  if (usdc && lower === usdc.toLowerCase()) return "USDC";
  throw new Error(`Unsupported payment token for v0 UI: ${token}`);
}

function resolvePaymentToken(mode: "USDC" | "ETH", chainId: number): Hex {
  if (mode === "ETH") return NATIVE_TOKEN as Hex;
  const usdc = usdcAddressForChainId(chainId);
  if (!usdc) throw new Error(`USDC is not configured for chain ${chainId}`);
  return usdc.toLowerCase() as Hex;
}

function parseMaxAmountWei(raw: string, mode: "USDC" | "ETH"): bigint {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Max amount is required");
  try {
    return mode === "ETH" ? parseEther(trimmed) : parseUnits(trimmed, 6);
  } catch {
    if (mode === "ETH") throw new Error("Max amount must be a valid ETH amount");
    throw new Error("Max amount must be a valid USDC amount");
  }
}

function parseOfferAmountWei(raw: string, mode: "USDC" | "ETH"): bigint {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Offer amount is required");
  try {
    return mode === "ETH" ? parseEther(trimmed) : parseUnits(trimmed, 6);
  } catch {
    if (mode === "ETH") throw new Error("Offer amount must be a valid ETH amount");
    throw new Error("Offer amount must be a valid USDC amount");
  }
}

function updateMaxAmountField(): void {
  const mode = resolvePaymentMode(paymentTokenInput.value);
  if (mode === "ETH") {
    maxAmountLabel.textContent = "Max amount in ETH";
    maxAmountInput.placeholder = "0.01";
    maxAmountInput.step = "0.000001";
    return;
  }

  maxAmountLabel.textContent = "Max Amount in $US";
  maxAmountInput.placeholder = "25.00";
  maxAmountInput.step = "0.01";
}

function updateOfferAmountField(): void {
  const mode = resolvePaymentMode(offerCurrencyInput.value);
  if (mode === "ETH") {
    offerAmountLabel.textContent = "Amount in ETH";
    offerAmountInput.placeholder = "0.01";
    offerAmountInput.step = "0.000001";
    return;
  }

  offerAmountLabel.textContent = "Amount in $US";
  offerAmountInput.placeholder = "25.00";
  offerAmountInput.step = "0.01";
}

function syncOfferCurrencyWithSelectedRequest(): void {
  if (!currentState?.state.contract) {
    updateOfferAmountField();
    return;
  }

  const requestId = offerRequestSelect.value.trim();
  if (!requestId) {
    updateOfferAmountField();
    return;
  }

  const request = currentState.state.openRequests.find((item) => item.requestId === requestId);
  if (!request) {
    updateOfferAmountField();
    return;
  }

  try {
    offerCurrencyInput.value = paymentModeFromToken(request.paymentToken, currentState.state.contract.chainId);
  } catch {
    // Keep user-selected currency when token is unsupported by this UI.
  }
  updateOfferAmountField();
}

function ensureStateAndContract(): BackgroundStateResponse {
  if (!currentState) throw new Error("Extension state is not loaded");
  if (!currentState.state.contract?.contractAddress) throw new Error("Contract is not configured in API /contract");
  return currentState;
}

function updateOfferRequestSelectionUi(): void {
  const selectedRequestId = offerRequestSelect.value.trim();
  const selectedRequest = currentState?.state.openRequests.find((request) => request.requestId === selectedRequestId);
  if (selectedRequest) {
    const domain = extractDomainFromSource(selectedRequest.sourceURI) || "unknown-domain";
    offerRequestSelection.textContent = `Selected request: ${domain} • ${selectedRequest.question.slice(0, 72)}`;
  } else {
    offerRequestSelection.textContent = "Select an open request above.";
  }

  matchedList.querySelectorAll("li[data-request-id]").forEach((item) => {
    const isSelected = item.getAttribute("data-request-id") === selectedRequestId;
    item.classList.toggle("selected", isSelected);
  });
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
    const paymentMode = resolvePaymentMode(paymentTokenInput.value);
    const paymentToken = resolvePaymentToken(paymentMode, state.state.contract!.chainId);
    const maxAmountRaw = maxAmountInput.value.trim();
    const maxAmountWei = parseMaxAmountWei(maxAmountRaw, paymentMode);
    const salt = randomSalt();

    if (!sourceURI || !question || !maxAmountRaw) throw new Error("Missing required requester fields");
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
      args: [sourceURI, question, paymentToken, maxAmountWei, salt as Hex]
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
      paymentMode,
      paymentToken,
      maxAmount: maxAmountRaw,
      maxAmountWei: maxAmountWei.toString(),
      salt
    });
    questionInput.value = "";
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
    const amountRaw = offerAmountInput.value.trim();
    const currency = resolvePaymentMode(offerCurrencyInput.value);
    const etaMinutesRaw = offerEtaInput.value.trim();
    const proofType = DEFAULT_OFFER_PROOF_TYPE;
    const salt = randomSalt();

    const request = requireOfferRequestById(requestId);
    const requestCurrency = paymentModeFromToken(request.paymentToken, state.state.contract!.chainId);
    if (currency !== requestCurrency) {
      throw new Error(`Currency must match selected request token (${requestCurrency})`);
    }
    const amountWei = parseOfferAmountWei(amountRaw, currency);
    if (!/^\d+$/.test(etaMinutesRaw)) throw new Error("ETA minutes must be a non-negative integer");
    if (!isHex(requestId, { strict: true }) || requestId.length !== 66) throw new Error("Invalid requestId");
    if (!isHex(salt, { strict: true }) || salt.length !== 66) throw new Error("Salt must be bytes32 hex");

    const accounts = await sendEthereumBridgeRequest<string[]>("eth_requestAccounts");
    const account = accounts?.[0];
    if (!account || !isAddress(account)) throw new Error("Wallet did not provide an account");

    const connectedChainId = await ensureWalletChain(state.state.contract!.chainId);

    const etaMinutes = BigInt(etaMinutesRaw);
    const etaSeconds = etaMinutes * 60n;
    const data = encodeFunctionData({
      abi: infoFiAbi,
      functionName: "postOffer",
      args: [requestId as Hex, amountWei, etaSeconds, proofType, salt as Hex]
    });
    const txHash = await sendEthereumBridgeRequest<string>("eth_sendTransaction", [
      { from: account, to: state.state.contract!.contractAddress, data }
    ]);
    const offerId = infoFiOfferId(requestId as Hex, account.toLowerCase() as Hex, amountWei, Number(etaSeconds), salt as Hex);

    showResult(offerResult, {
      ok: true,
      chainId: connectedChainId,
      account: account.toLowerCase(),
      requestId,
      offerId,
      txHash,
      currency,
      amount: amountRaw,
      amountWei: amountWei.toString(),
      etaMinutes: etaMinutes.toString(),
      etaSeconds: etaSeconds.toString(),
      proofType,
      salt
    });
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
paymentTokenInput.addEventListener("change", updateMaxAmountField);
offerCurrencyInput.addEventListener("change", updateOfferAmountField);
offerRequestSelect.addEventListener("change", () => {
  syncOfferCurrencyWithSelectedRequest();
  updateOfferRequestSelectionUi();
});

postRequestForm.addEventListener("submit", (event) => {
  void handlePostRequest(event);
});

postOfferForm.addEventListener("submit", (event) => {
  void handlePostOffer(event);
});

void (async () => {
  updateMaxAmountField();
  updateOfferAmountField();
  await prefillSourceFromActiveTab();
  const state = await loadBackgroundState(false);
  renderState(state);
})();

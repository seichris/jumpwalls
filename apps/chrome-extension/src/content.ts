import type { EthereumBridgeResponse, RuntimeMessage } from "./types";

const INPAGE_SCRIPT_ID = "__infofi-inpage-bridge";
const CONTENT_REQUEST = "INFOFI_INPAGE_REQUEST";
const INPAGE_RESPONSE = "INFOFI_INPAGE_RESPONSE";
const CONTENT_SOURCE = "infofi-extension-content";
const INPAGE_SOURCE = "infofi-extension-inpage";

function injectInpageBridge(): void {
  if (document.getElementById(INPAGE_SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = INPAGE_SCRIPT_ID;
  script.src = chrome.runtime.getURL("inpage.js");
  script.type = "module";
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

function randomRequestId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function relayToInpage(method: string, params: unknown[] = []): Promise<unknown> {
  injectInpageBridge();
  const requestId = randomRequestId();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for in-page wallet response"));
    }, 30_000);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as Record<string, unknown> | undefined;
      if (!data || data.source !== INPAGE_SOURCE || data.type !== INPAGE_RESPONSE || data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (typeof data.error === "string" && data.error) {
        reject(new Error(data.error));
      } else {
        resolve(data.result);
      }
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: CONTENT_SOURCE,
        type: CONTENT_REQUEST,
        requestId,
        method,
        params
      },
      "*"
    );
  });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type !== "INFOFI_ETHEREUM_REQUEST") return false;

  void relayToInpage(message.method, message.params)
    .then((result) => {
      sendResponse({ ok: true, result } as EthereumBridgeResponse);
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Wallet bridge request failed"
      } as EthereumBridgeResponse);
    });

  return true;
});

injectInpageBridge();

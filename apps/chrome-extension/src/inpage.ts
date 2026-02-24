const CONTENT_SOURCE = "infofi-extension-content";
const INPAGE_SOURCE = "infofi-extension-inpage";
const CONTENT_REQUEST = "INFOFI_INPAGE_REQUEST";
const INPAGE_RESPONSE = "INFOFI_INPAGE_RESPONSE";

function toErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Wallet provider request failed";
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || data.source !== CONTENT_SOURCE || data.type !== CONTENT_REQUEST) return;

  const requestId = data.requestId;
  const method = typeof data.method === "string" ? data.method : "";
  const params = Array.isArray(data.params) ? data.params : [];

  void (async () => {
    try {
      const provider = (window as unknown as { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<unknown> } })
        .ethereum;
      if (!provider?.request) {
        throw new Error("No injected wallet provider found in active tab");
      }
      const result = await provider.request({ method, params });
      window.postMessage({ source: INPAGE_SOURCE, type: INPAGE_RESPONSE, requestId, result }, "*");
    } catch (error) {
      window.postMessage({ source: INPAGE_SOURCE, type: INPAGE_RESPONSE, requestId, error: toErrorMessage(error) }, "*");
    }
  })();
});

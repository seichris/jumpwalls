import type { ExtensionSettings, ExtensionState } from "./types";

export const STORAGE_SETTINGS_KEY = "infofi_extension_settings";
export const STORAGE_STATE_KEY = "infofi_extension_state";
export const REFRESH_ALARM = "infofi_extension_refresh";
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiUrl: "https://info-api.8o.vc",
  historyLookbackDays: 90,
  subscriptionByDomain: {},
  shareDemandSignals: false,
  demandSignalClientId: ""
};

export const EMPTY_STATE: ExtensionState = {
  contract: null,
  openRequests: [],
  matchedByRequestId: {},
  lastUpdatedAt: 0,
  error: null
};

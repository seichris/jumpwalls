import { DEFAULT_SETTINGS, EMPTY_STATE, STORAGE_SETTINGS_KEY, STORAGE_STATE_KEY } from "./constants";
import type { ExtensionSettings, ExtensionState } from "./types";

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_SETTINGS_KEY] as Partial<ExtensionSettings> | undefined) };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: settings });
}

export async function getState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get(STORAGE_STATE_KEY);
  return { ...EMPTY_STATE, ...(stored[STORAGE_STATE_KEY] as Partial<ExtensionState> | undefined) };
}

export async function saveState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_STATE_KEY]: state });
}

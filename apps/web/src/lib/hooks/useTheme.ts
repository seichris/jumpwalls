import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "infofi-theme";
const LIGHT_FAVICON = "/jumping_walls_icon-light.svg";
const DARK_FAVICON = "/jumping_walls_icon-dark.svg";

function updateFavicon(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const href = theme === "dark" ? DARK_FAVICON : LIGHT_FAVICON;
  const iconLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]'));

  if (iconLinks.length === 0) {
    const fallbackIcon = document.createElement("link");
    fallbackIcon.rel = "icon";
    fallbackIcon.href = href;
    fallbackIcon.type = "image/svg+xml";
    document.head.appendChild(fallbackIcon);
    return;
  }

  for (const link of iconLinks) {
    link.href = href;
    link.media = "all";
    link.type = "image/svg+xml";
  }
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  updateFavicon(theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    return prefersDark ? "dark" : "light";
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    applyTheme(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  return { theme, setTheme, toggle, mounted: true };
}

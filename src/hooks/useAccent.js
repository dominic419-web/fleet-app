"use client";

import * as React from "react";

const STORAGE_KEY = "fleet.accent";

const AccentContext = React.createContext(null);

export function AccentProvider({ children, defaultAccent = "blue" }) {
  const [accent, setAccentState] = React.useState(defaultAccent);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "blue" || saved === "amber") {
        setAccentState(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    const el = document.documentElement;
    el.dataset.accent = accent;
    try {
      window.localStorage.setItem(STORAGE_KEY, accent);
    } catch {
      // ignore
    }
  }, [accent]);

  const setAccent = React.useCallback((next) => {
    setAccentState(next === "amber" ? "amber" : "blue");
  }, []);

  const toggleAccent = React.useCallback(() => {
    setAccentState((prev) => (prev === "amber" ? "blue" : "amber"));
  }, []);

  const value = React.useMemo(
    () => ({ accent, setAccent, toggleAccent }),
    [accent, setAccent, toggleAccent]
  );

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}

export function useAccent() {
  const ctx = React.useContext(AccentContext);
  if (!ctx) {
    throw new Error("useAccent must be used within AccentProvider");
  }
  return ctx;
}


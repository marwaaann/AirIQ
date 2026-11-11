"use client";

import { useEffect } from "react";
import { z } from "@/lib/zod";

import { MoonIcon, SunIcon } from "@/components/icons";
import { createStoredValue, useHydrated, useStoredValue } from "@/lib/storage";

import { THEME_STORAGE_KEY } from "@/lib/theme";
type ThemePref = "light" | "dark" | "system";

const themeStore = createStoredValue<ThemePref>(THEME_STORAGE_KEY, z.enum(["light", "dark", "system"]), "system");

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light/dark switch. The initial theme is applied pre-paint by the script in app/layout.tsx. */
export function ThemeToggle() {
  const [pref, setPref] = useStoredValue(themeStore);
  const hydrated = useHydrated();

  useEffect(() => {
    const apply = () => document.documentElement.setAttribute("data-theme", resolve(pref));
    apply();
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);

  // Before hydration we don't know the resolved theme; render a neutral button.
  const current = hydrated ? resolve(pref) : null;
  const next = current === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setPref(next)}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-text hover:bg-surface-2"
      aria-label={current ? `Switch to ${next} theme` : "Toggle theme"}
      title={current ? `Switch to ${next} theme` : "Toggle theme"}
    >
      {current === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

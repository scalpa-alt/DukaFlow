"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// Chrome and Edge fire this event when the app can be installed. It is not in TypeScript's built-in types.
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallContext = {
  /** The browser is ready to show its own install dialog. */
  canInstall: boolean;
  /** iPhone or iPad Safari: no install dialog exists, so we show steps instead. */
  needsIosSteps: boolean;
  /** Already running as an installed app. */
  installed: boolean;
  /** The person closed the banner. */
  bannerHidden: boolean;
  hideBanner: () => void;
  install: () => Promise<void>;
};

const Ctx = createContext<InstallContext | null>(null);
const HIDDEN_KEY = "dukaflow.install-banner-hidden";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function InstallProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [needsIosSteps, setNeedsIosSteps] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(true); // hidden until we have read the saved choice

  useEffect(() => {
    setInstalled(isStandalone());
    try {
      setBannerHidden(localStorage.getItem(HIDDEN_KEY) === "1");
    } catch {
      setBannerHidden(false);
    }

    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    setNeedsIosSteps(ios && safari && !isStandalone());

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the dialog for our own button
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const hideBanner = useCallback(() => {
    setBannerHidden(true);
    try {
      localStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // private mode: the banner just comes back next visit
    }
  }, []);

  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    const choice = await event.userChoice;
    setEvent(null); // the browser only lets each event be used once
    if (choice.outcome === "accepted") setInstalled(true);
  }, [event]);

  return (
    <Ctx.Provider value={{ canInstall: Boolean(event) && !installed, needsIosSteps, installed, bannerHidden, hideBanner, install }}>
      {children}
    </Ctx.Provider>
  );
}

export function useInstall() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useInstall must be used inside InstallProvider");
  return value;
}

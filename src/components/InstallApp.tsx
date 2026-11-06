"use client";

import { useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useInstall } from "@/lib/install";

/** Small bar at the top of the app. Shown only when installing is possible and not yet dismissed. */
export function InstallBanner() {
  const { canInstall, needsIosSteps, installed, bannerHidden, hideBanner, install } = useInstall();
  const [showSteps, setShowSteps] = useState(false);

  if (installed || bannerHidden || (!canInstall && !needsIosSteps)) return null;

  return (
    <div className="no-print border-b border-border bg-primary/10 px-4 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        <Download className="size-5 shrink-0 text-primary" />
        <p className="min-w-0 flex-1">Install DukaFlow on this phone. It opens faster and works offline.</p>
        {canInstall ? (
          <Button size="sm" onClick={() => void install()}>
            Install
          </Button>
        ) : (
          <Button size="sm" onClick={() => setShowSteps((v) => !v)}>
            How
          </Button>
        )}
        <button type="button" aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={hideBanner}>
          <X className="size-4" />
        </button>
      </div>
      {showSteps && needsIosSteps ? <IosSteps /> : null}
    </div>
  );
}

/** A row in Settings that is always there, so the person can install later. */
export function InstallRow() {
  const { canInstall, needsIosSteps, installed, install } = useInstall();

  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Download className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Install the app</p>
          <p className="text-xs text-muted-foreground">
            {installed ? "DukaFlow is installed on this device." : "Add DukaFlow to your home screen. It opens full screen and works offline."}
          </p>
        </div>
        {canInstall && !installed ? (
          <Button size="sm" onClick={() => void install()}>
            Install
          </Button>
        ) : null}
      </div>
      {needsIosSteps && !installed ? <IosSteps /> : null}
      {!installed && !canInstall && !needsIosSteps ? (
        <p className="text-xs text-muted-foreground">
          If you don't see an Install button, open your browser's menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.
        </p>
      ) : null}
    </section>
  );
}

function IosSteps() {
  return (
    <ol className="mt-2 space-y-1.5 rounded-xl bg-muted p-3 text-sm">
      <li className="flex items-center gap-2">
        <Share className="size-4 shrink-0 text-primary" /> Tap the <b>Share</b> button at the bottom of Safari.
      </li>
      <li className="flex items-center gap-2">
        <SquarePlus className="size-4 shrink-0 text-primary" /> Scroll and tap <b>Add to Home Screen</b>.
      </li>
      <li className="flex items-center gap-2">
        <Download className="size-4 shrink-0 text-primary" /> Tap <b>Add</b>. DukaFlow now sits with your other apps.
      </li>
    </ol>
  );
}

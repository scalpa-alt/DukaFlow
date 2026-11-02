"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Loader2 } from "lucide-react";

/**
 * Camera barcode scanner. The scanning library is loaded only when the camera is switched on,
 * so it never runs on the server.
 */
export function BarcodeScanner({ active, onDetected }: { active: boolean; onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  // Keep the newest callback without restarting the camera every time the parent re-renders
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const [status, setStatus] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!active) return;
    let controls: { stop: () => void } | undefined;
    let cancelled = false;

    setStatus("starting");
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        if (cancelled || !videoRef.current) return;
        controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result: { getText: () => string } | undefined) => {
            if (!result) return;
            const code = result.getText();
            const now = Date.now();
            // Ignore the same code seen again within 2 seconds
            if (lastRef.current.code === code && now - lastRef.current.at < 2000) return;
            lastRef.current = { code, at: now };
            onDetectedRef.current(code);
          },
        );
        if (cancelled) controls?.stop();
        else setStatus("running");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Camera permission was blocked. Allow camera access, or type the barcode instead."
            : "No camera available here. You can type the barcode instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground/90">
      <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline autoPlay />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-24 w-4/5 rounded-xl border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>
      {status === "starting" ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-foreground/60 text-sm text-background">
          <Loader2 className="size-4 animate-spin" /> Starting camera…
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-foreground/80 px-6 text-center text-sm text-background">
          <CameraOff className="size-5" />
          {message}
        </div>
      ) : null}
    </div>
  );
}

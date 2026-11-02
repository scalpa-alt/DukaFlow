"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth";
import { PrefsProvider } from "@/lib/prefs";

export function Providers({ children }: { children: ReactNode }) {
  // One query cache for the whole app
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }));

  return (
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <AuthProvider>
          {children}
          <Toaster position="top-center" richColors />
        </AuthProvider>
      </PrefsProvider>
    </QueryClientProvider>
  );
}

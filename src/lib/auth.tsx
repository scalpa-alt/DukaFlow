import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Role = "owner" | "seller";
type Ctx = { session: Session | null; role: Role | null; loading: boolean; isOwner: boolean; isPlatformAdmin: boolean; signOut: () => Promise<void> };
const AuthCtx = createContext<Ctx | null>(null);
const ROLE_KEY = "dukaflow.role";

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRole = async (s: Session | null) => {
      if (!s) { setRole(null); setIsPlatformAdmin(false); return; }
      const cached = localStorage.getItem(ROLE_KEY) as Role | null;
      if (cached) setRole(cached);
      const { data, error } = await supabase.rpc("claim_role");
      if (!error && data) { setRole(data as Role); localStorage.setItem(ROLE_KEY, data as string); }
      const { data: adminRow } = await supabase.from("platform_admins").select("user_id").eq("user_id", s.user.id).maybeSingle();
      setIsPlatformAdmin(!!adminRow);
    };
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadRole(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      setSession(s);
      if (event === "SIGNED_OUT") { localStorage.removeItem(ROLE_KEY); setRole(null); qc.clear(); return; }
      void loadRole(s).then(() => qc.invalidateQueries());
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const signOut = async () => { await supabase.auth.signOut(); };
  return (
    <AuthCtx.Provider value={{ session, role, loading, isOwner: role === "owner", isPlatformAdmin, signOut }}>{children}</AuthCtx.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

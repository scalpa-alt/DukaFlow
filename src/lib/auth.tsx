"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type Role = "owner" | "seller";

type AuthContext = {
  session: Session | null;
  role: Role | null; // null until the person has created or joined a shop
  loading: boolean;
  isOwner: boolean;
  isPlatformAdmin: boolean;
  blocked: { reason: string; shopName: string } | null; // set when the platform admin has blocked this person's shop
  signOut: () => Promise<void>;
  refresh: () => Promise<void>; // re-check the role after creating or joining a shop
};

const Ctx = createContext<AuthContext | null>(null);
const ROLE_KEY = "dukaflow.role";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [blocked, setBlocked] = useState<{ reason: string; shopName: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBlocked = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_shop_status");
    if (error) return; // offline or not set up yet: keep what we knew
    const row = (data as { blocked: boolean; reason: string; shop_name: string }[] | null)?.[0];
    setBlocked(row?.blocked ? { reason: row.reason ?? "", shopName: row.shop_name ?? "" } : null);
  }, []);

  const loadRole = useCallback(async (s: Session | null) => {
    if (!s) {
      setRole(null);
      setBlocked(null);
      setIsPlatformAdmin(false);
      return;
    }
    // Show the last known role straight away so the app opens offline.
    const cached = localStorage.getItem(ROLE_KEY) as Role | null;
    if (cached) setRole(cached);

    const { data, error } = await supabase.rpc("claim_role");
    if (!error) {
      if (data) {
        setRole(data as Role);
        localStorage.setItem(ROLE_KEY, data as string);
      } else {
        setRole(null);
        localStorage.removeItem(ROLE_KEY);
      }
    }
    const { data: adminRow } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", s.user.id)
      .maybeSingle();
    setIsPlatformAdmin(Boolean(adminRow));
    await loadBlocked();
  }, [loadBlocked]);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadRole(data.session).catch(() => undefined);
      if (alive) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      setSession(next);
      if (event === "SIGNED_OUT") {
        localStorage.removeItem(ROLE_KEY);
        setRole(null);
        setBlocked(null);
        setIsPlatformAdmin(false);
        queryClient.clear();
        return;
      }
      // Run outside the callback: calling Supabase from inside it can hang.
      // Keep the loading screen up until the role and admin check are known, so a platform admin
      // never sees the "create or join a shop" screen for a moment.
      setLoading(true);
      setTimeout(() => {
        void loadRole(next)
          .catch(() => undefined)
          .then(() => queryClient.invalidateQueries())
          .finally(() => setLoading(false));
      }, 0);
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [loadRole, queryClient]);

  // Notice a block (or an unblock) while the app is open
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => void loadBlocked(), 60_000);
    const onFocus = () => void loadBlocked();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [session, loadBlocked]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refresh = async () => {
    const { data } = await supabase.auth.getSession();
    await loadRole(data.session);
    await queryClient.invalidateQueries();
  };

  return (
    <Ctx.Provider value={{ session, role, loading, isOwner: role === "owner", isPlatformAdmin, blocked, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

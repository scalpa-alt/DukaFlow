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
  const [loading, setLoading] = useState(true);

  const loadRole = useCallback(async (s: Session | null) => {
    if (!s) {
      setRole(null);
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
  }, []);

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
        setIsPlatformAdmin(false);
        queryClient.clear();
        return;
      }
      // Run outside the callback: calling Supabase from inside it can hang.
      setTimeout(() => {
        void loadRole(next).then(() => queryClient.invalidateQueries());
      }, 0);
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [loadRole, queryClient]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refresh = async () => {
    const { data } = await supabase.auth.getSession();
    await loadRole(data.session);
    await queryClient.invalidateQueries();
  };

  return (
    <Ctx.Provider value={{ session, role, loading, isOwner: role === "owner", isPlatformAdmin, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { sendJoinCodeEmail } from "@/lib/email.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

// Each shop has its own settings row, so look it up by the signed-in owner's shop.
async function myShopId(): Promise<string | null> {
  const { data } = await supabase.rpc("current_shop_id");
  return (data as string | null) ?? null;
}

type Settings = { shop_name: string; enforce_hours: boolean; open_time: string; close_time: string };

export function OwnerSettings() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const settings = useQuery({
    queryKey: ["shop-settings"],
    queryFn: async () => {
      const shopId = await myShopId();
      if (!shopId) return null;
      const { data, error } = await supabase.from("shop_settings").select("*").eq("shop_id", shopId).maybeSingle();
      if (error) throw error;
      return data as Settings | null;
    },
  });
  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const [{ data: roles, error }, { data: profiles }] = await Promise.all([
        supabase.from("user_roles").select("id,user_id,role"),
        supabase.from("profiles").select("id,display_name"),
      ]);
      if (error) throw error;
      return (roles ?? []).map((r) => ({ ...r, name: profiles?.find((p) => p.id === r.user_id)?.display_name || "Staff" }));
    },
  });
  const sendCode = useServerFn(sendJoinCodeEmail);
  const [emailing, setEmailing] = useState(false);
  const emailCode = async () => {
    setEmailing(true);
    try {
      const r = await sendCode();
      if (r.ok) toast.success(r.message); else toast.error(r.message);
    } catch {
      toast.error("Could not send the email. Try again.");
    }
    setEmailing(false);
  };
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      const shopId = await myShopId();
      if (!shopId) throw new Error("You don't belong to a shop yet");
      const { error } = await supabase.from("shop_settings").update(form!).eq("shop_id", shopId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Shop settings saved"); qc.invalidateQueries({ queryKey: ["shop-settings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "owner" | "seller" | null }) => {
      const { error } = role
        ? await supabase.from("user_roles").update({ role }).eq("id", id)
        : await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h2 className="font-display text-lg font-semibold">Shop & hours</h2>
        {form ? (
          <>
            <Input value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} placeholder="Shop name" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enforce_hours} onChange={(e) => setForm({ ...form, enforce_hours: e.target.checked })} className="size-4" />
              Sellers can only sell during opening hours
            </label>
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-muted-foreground">Opens
                <Input type="time" value={form.open_time.slice(0, 5)} onChange={(e) => setForm({ ...form, open_time: e.target.value })} /></label>
              <label className="flex-1 text-xs text-muted-foreground">Closes
                <Input type="time" value={form.close_time.slice(0, 5)} onChange={(e) => setForm({ ...form, close_time: e.target.value })} /></label>
            </div>
            <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </>
        ) : <p className="text-sm text-muted-foreground">Loading…</p>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-1 font-display text-lg font-semibold">Staff</h2>
        <p className="mb-3 text-xs text-muted-foreground">New staff create their own account on the sign-in page, then enter your shop code to join as sellers. The code is sent to your email.</p>
        <Button size="sm" variant="outline" className="mb-3" disabled={emailing} onClick={() => void emailCode()}>Email me the shop code</Button>
        <ul className="divide-y divide-border text-sm">
          {(staff.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2">
              <span>{s.name} <span className="text-muted-foreground">· {s.role}</span></span>
              {s.user_id === session?.user.id ? <span className="text-xs text-muted-foreground">You</span> : (
                <span className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setRole.mutate({ id: s.id, role: s.role === "owner" ? "seller" : "owner" })}>
                    Make {s.role === "owner" ? "seller" : "owner"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRole.mutate({ id: s.id, role: null })}>Remove</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

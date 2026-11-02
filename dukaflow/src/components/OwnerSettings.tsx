"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, UserMinus } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { postApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type ShopSettings = { id: number; shop_name: string; enforce_hours: boolean; open_time: string; close_time: string };
type Staff = { id: string; user_id: string; role: "owner" | "seller"; name: string };

// "07:00:00" -> "07:00" for the time inputs
const hhmm = (value: string) => value.slice(0, 5);

async function loadSettings(): Promise<ShopSettings | null> {
  // The shop comes from the signed-in person's own role, so every shop sees only its own row
  const { data: shopId } = await supabase.rpc("current_shop_id");
  if (!shopId) return null;
  const { data, error } = await supabase
    .from("shop_settings")
    .select("id,shop_name,enforce_hours,open_time,close_time")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ShopSettings | null;
}

async function loadStaff(): Promise<Staff[]> {
  const { data: roles, error } = await supabase.from("user_roles").select("id,user_id,role").order("role");
  if (error) throw new Error(error.message);
  const ids = (roles ?? []).map((r) => r.user_id as string);
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id,display_name").in("id", ids)
    : { data: [] as { id: string; display_name: string }[] };
  const names = new Map((people ?? []).map((p) => [p.id as string, p.display_name as string]));
  return (roles ?? []).map((r) => ({
    id: r.id as string,
    user_id: r.user_id as string,
    role: r.role as "owner" | "seller",
    name: names.get(r.user_id as string) || `User ${String(r.user_id).slice(0, 6)}`,
  }));
}

export function OwnerSettings() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const myId = session?.user.id;

  const settings = useQuery({ queryKey: ["shop-settings"], queryFn: loadSettings });
  const staff = useQuery({ queryKey: ["staff"], queryFn: loadStaff });

  const [name, setName] = useState("");
  const [enforce, setEnforce] = useState(false);
  const [open, setOpen] = useState("07:00");
  const [close, setClose] = useState("21:00");

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setName(s.shop_name);
    setEnforce(s.enforce_hours);
    setOpen(hhmm(s.open_time));
    setClose(hhmm(s.close_time));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!settings.data) throw new Error("Shop settings were not found");
      const { error } = await supabase
        .from("shop_settings")
        .update({ shop_name: name.trim() || "My Shop", enforce_hours: enforce, open_time: open, close_time: close })
        .eq("id", settings.data.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Shop settings saved");
      void queryClient.invalidateQueries({ queryKey: ["shop-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["shop-open"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "owner" | "seller" }) => {
      const { error } = await supabase.from("user_roles").update({ role }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["staff"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Removed from the shop");
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emailCode = useMutation({
    mutationFn: () => postApi("/api/email/join-code"),
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
  });

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h2 className="font-display text-lg font-semibold">Shop</h2>
        {settings.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {settings.data ? (
          <>
            <label className="block text-xs text-muted-foreground">
              Shop name
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
              Only allow selling during opening hours
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted-foreground">
                Opens
                <Input type="time" value={open} disabled={!enforce} onChange={(e) => setOpen(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Closes
                <Input type="time" value={close} disabled={!enforce} onChange={(e) => setClose(e.target.value)} />
              </label>
            </div>
            <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
              Save shop settings
            </Button>
          </>
        ) : null}
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <h2 className="font-display text-lg font-semibold">Shop code</h2>
        <p className="text-sm text-muted-foreground">
          Sellers need your shop code to join. For safety it is not shown here. We email it to the address you signed up with.
        </p>
        <Button variant="secondary" className="w-full" disabled={emailCode.isPending} onClick={() => emailCode.mutate()}>
          <Mail className="mr-2 size-4" />
          {emailCode.isPending ? "Sending…" : "Email me the shop code"}
        </Button>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 font-display text-lg font-semibold">Staff</h2>
        {staff.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        <ul className="divide-y divide-border text-sm">
          {(staff.data ?? []).map((s) => {
            const me = s.user_id === myId;
            return (
              <li key={s.id} className="flex items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {s.name}
                    {me ? " (you)" : ""}
                  </p>
                  <p className="text-xs capitalize text-muted-foreground">{s.role}</p>
                </div>
                {me ? null : (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={setRole.isPending}
                      onClick={() => setRole.mutate({ id: s.id, role: s.role === "owner" ? "seller" : "owner" })}
                    >
                      {s.role === "owner" ? "Make seller" : "Make owner"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 text-destructive"
                      aria-label="Remove from shop"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove ${s.name} from the shop?`)) remove.mutate(s.id);
                      }}
                    >
                      <UserMinus className="size-4" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

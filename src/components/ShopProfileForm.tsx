"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Store, Trash2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { fetchShopProfile, removeShopLogo, saveShopProfile, uploadShopLogo, type ShopProfile } from "@/lib/shop";

const emptyForm = { owner_name: "", contact_phone: "", contact_email: "", address: "", receipt_footer: "" };

/** Owner-only: the logo and contact details that are printed at the top of every receipt. */
export function ShopProfileForm() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const profile = useQuery({ queryKey: ["shop-profile"], queryFn: fetchShopProfile });
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    setForm({
      owner_name: p.owner_name,
      contact_phone: p.contact_phone,
      contact_email: p.contact_email,
      address: p.address,
      receipt_footer: p.receipt_footer,
    });
  }, [profile.data]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["shop-profile"] });

  const save = useMutation({
    mutationFn: () => saveShopProfile((profile.data as ShopProfile).id, form),
    onSuccess: () => {
      toast.success("Receipt details saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadShopLogo(profile.data as ShopProfile, file),
    onSuccess: () => {
      toast.success("Logo updated");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => removeShopLogo(profile.data as ShopProfile),
    onSuccess: () => {
      toast.success("Logo removed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const p = profile.data;
  const busy = upload.isPending || remove.isPending;
  const set = (key: keyof typeof emptyForm) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Receipt details</h2>
        <p className="text-sm text-muted-foreground">Your logo and contacts appear at the top of every receipt you print or share.</p>
      </div>

      {profile.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {profile.error ? <p className="text-sm text-destructive">{(profile.error as Error).message}</p> : null}

      {p ? (
        <>
          <div className="flex items-center gap-3">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
              {p.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logo_url} alt="Shop logo" className="size-full object-contain" />
              ) : (
                <Store className="size-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // lets the same picture be chosen again
                  if (file) upload.mutate(file);
                }}
              />
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
                <ImagePlus className="mr-2 size-4" />
                {upload.isPending ? "Uploading…" : p.logo_url ? "Change logo" : "Add logo"}
              </Button>
              {p.logo_url ? (
                <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => remove.mutate()}>
                  <Trash2 className="mr-2 size-4" />
                  Remove logo
                </Button>
              ) : null}
            </div>
          </div>

          <label className="block text-xs text-muted-foreground">
            Owner's name
            <Input value={form.owner_name} onChange={set("owner_name")} placeholder="e.g. Amina Wanjiru" />
          </label>
          <label className="block text-xs text-muted-foreground">
            Shop phone number
            <Input value={form.contact_phone} onChange={set("contact_phone")} inputMode="tel" placeholder="07XX XXX XXX" />
          </label>
          <label className="block text-xs text-muted-foreground">
            Shop email
            <Input value={form.contact_email} onChange={set("contact_email")} type="email" placeholder="shop@example.com" />
          </label>
          <label className="block text-xs text-muted-foreground">
            Address or location
            <Input value={form.address} onChange={set("address")} placeholder="e.g. Gikomba Market, Nairobi" />
          </label>
          <label className="block text-xs text-muted-foreground">
            Message at the bottom of the receipt
            <Input value={form.receipt_footer} onChange={set("receipt_footer")} maxLength={120} />
          </label>

          <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save receipt details"}
          </Button>
        </>
      ) : null}
    </section>
  );
}

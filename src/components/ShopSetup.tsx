"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Store, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { postApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fetchShopProfile, saveShopProfile, uploadShopLogo } from "@/lib/shop";
import { Button, Input } from "@/components/ui";

const DEFAULT_FOOTER = "Thank you for shopping with us!";
const MAX_LOGO_BYTES = 10 * 1024 * 1024;

/** Shown to a signed-in person who has no shop yet: create one (with its receipt details), or join one with a code. */
export function ShopSetup() {
  const { session, signOut, refresh } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: "",
    owner_name: "",
    contact_phone: "",
    contact_email: session?.user.email ?? "",
    address: "",
    receipt_footer: DEFAULT_FOOTER,
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  // Preview of the chosen picture, released when it changes or the screen closes
  useEffect(() => {
    if (!logo) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast.error("Please choose a picture (PNG, JPG or WebP)");
    if (file.size > MAX_LOGO_BYTES) return void toast.error("That picture is too big. Choose one under 10 MB");
    setLogo(file);
  };

  const createShop = async () => {
    const email = form.contact_email.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return void toast.error("Check the shop email address");

    setBusy(true);
    const { error } = await supabase.rpc("create_shop", { p_name: form.name });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }

    // The shop exists now. Save the receipt details and the logo. If either fails the shop is still
    // usable, so say what to redo instead of stopping.
    const problems: string[] = [];
    try {
      const profile = await fetchShopProfile();
      if (!profile) throw new Error("Shop settings were not found");
      await saveShopProfile(profile.id, {
        owner_name: form.owner_name,
        contact_phone: form.contact_phone,
        contact_email: email,
        address: form.address,
        receipt_footer: form.receipt_footer.trim() || DEFAULT_FOOTER,
      });
      if (logo) {
        try {
          await uploadShopLogo(profile, logo);
        } catch {
          problems.push("the logo");
        }
      }
    } catch {
      problems.push("the receipt details");
    }
    if (problems.length) toast.warning(`Shop created, but ${problems.join(" and ")} did not save. Add ${problems.length > 1 ? "them" : "it"} in Settings → Receipt details.`);

    // Email the owner the join code for their staff.
    const mail = await postApi("/api/email/join-code");
    if (mail.ok) toast.success(mail.message);
    else toast.message("Shop created. " + mail.message);
    await refresh();
    setBusy(false);
  };

  const joinShop = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("join_shop", { p_code: code });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    await refresh();
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen justify-center bg-background px-4 py-8">
      <div className="h-fit w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-6">
        <div className="text-center">
          <Store className="mx-auto size-10 text-primary" />
          <h1 className="mt-2 font-display text-2xl font-bold">Set up your shop</h1>
          <p className="text-sm text-muted-foreground">Signed in as {session?.user.email}</p>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void createShop();
          }}
        >
          <div>
            <h2 className="font-semibold">I own a shop</h2>
            <p className="text-xs text-muted-foreground">These details are printed at the top of every receipt. You can change them later in Settings.</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="Your logo" className="size-full object-contain" />
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
                  pickLogo(e.target.files?.[0]);
                  e.target.value = ""; // lets the same picture be chosen again
                }}
              />
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
                <ImagePlus className="mr-2 size-4" />
                {logo ? "Change logo" : "Add shop logo"}
              </Button>
              {logo ? (
                <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setLogo(null)}>
                  <Trash2 className="mr-2 size-4" />
                  Remove
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Optional. A square picture works best.</span>
              )}
            </div>
          </div>

          <label className="block text-xs text-muted-foreground">
            Shop name
            <Input required placeholder="e.g. Mama Njeri Groceries" value={form.name} onChange={set("name")} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Owner's name
            <Input required placeholder="e.g. Njeri Wanjiru" value={form.owner_name} onChange={set("owner_name")} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-muted-foreground">
              Shop phone
              <Input inputMode="tel" placeholder="07XX XXX XXX" value={form.contact_phone} onChange={set("contact_phone")} />
            </label>
            <label className="block text-xs text-muted-foreground">
              Shop email
              <Input type="email" placeholder="shop@example.com" value={form.contact_email} onChange={set("contact_email")} />
            </label>
          </div>
          <label className="block text-xs text-muted-foreground">
            Address or location
            <Input placeholder="e.g. Gikomba Market, Nairobi" value={form.address} onChange={set("address")} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Message at the bottom of receipts
            <Input maxLength={120} value={form.receipt_footer} onChange={set("receipt_footer")} />
          </label>

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Creating your shop…" : "Create shop"}
          </Button>
          <p className="text-xs text-muted-foreground">Your shop code will be emailed to {session?.user.email}.</p>
        </form>

        <div className="border-t border-border" />

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void joinShop();
          }}
        >
          <h2 className="font-semibold">I work at a shop</h2>
          <Input required placeholder="Shop code from the owner" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <Button type="submit" variant="outline" className="w-full" disabled={busy}>
            Join shop
          </Button>
        </form>

        <button type="button" className="w-full text-sm text-muted-foreground" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

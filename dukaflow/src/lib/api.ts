import { getAccessToken } from "@/lib/supabase";

export type ApiResult = { ok: boolean; message: string };

/** Calls one of our own API routes as the signed-in user. */
export async function postApi(path: string, body?: unknown): Promise<ApiResult> {
  try {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<ApiResult>;
    return {
      ok: Boolean(res.ok && data.ok),
      message: data.message ?? (res.ok ? "Done" : "Something went wrong. Try again."),
    };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your internet connection." };
  }
}

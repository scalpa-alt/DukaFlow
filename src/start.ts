import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// Attaches the signed-in user's Supabase token to every server function call
// (M-Pesa prompts, join-code emails).
export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
}));

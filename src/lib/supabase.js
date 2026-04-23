import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** True when stored refresh token is unusable (expired session, revoked user, race, cleared DB). */
export function isSupabaseRefreshTokenBrokenError(error) {
  if (!error || typeof error !== 'object') return false;
  const code = String(error.code || "").toLowerCase();
  const msg = String(error.message || "").toLowerCase();
  return (
    code === "refresh_token_not_found" ||
    code === "invalid_grant" ||
    msg.includes("refresh token not found") ||
    msg.includes("invalid refresh token") ||
    (msg.includes("refresh") && msg.includes("token") && msg.includes("not found"))
  );
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "TOKEN_REFRESH_FAILED") {
      void supabase.auth.signOut({ scope: "local" }).catch(() => {});
    }
  });
}
import { createClient, type Session } from '@supabase/supabase-js';

function normalizeSupabaseUrl(raw?: string): string {
  const cleaned = (raw ?? '').trim();
  const fallback = 'https://gnpcevtnbzpajcrtifbc.supabase.co';
  if (!cleaned || /YOUR_PROJECT_ID|YOUR_SUPABASE/i.test(cleaned)) {
    return fallback;
  }
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      return fallback;
    }
  }
  if (/^[a-z0-9-]+$/i.test(cleaned)) {
    return `https://${cleaned}.supabase.co`;
  }
  return fallback;
}

function normalizeSupabaseKey(raw?: string): string {
  const cleaned = (raw ?? '').trim();
  const fallback = 'sb_publishable_iBu2iCm5oUGdVTwLFlao7w_Hus2m5Uh';
  if (!cleaned || /YOUR_SUPABASE|MY_/i.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

const SUPABASE_URL = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_KEY = normalizeSupabaseKey(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export async function signUpWithSupabaseEmail(email: string, password: string) {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/` : undefined;
  return supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: redirectTo,
    },
  });
}

export async function signInWithSupabaseEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

export async function resendSupabaseVerification(email: string) {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/` : undefined;
  return supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: {
      emailRedirectTo: redirectTo,
    },
  });
}

export async function signOutSupabase() {
  return supabase.auth.signOut();
}

export async function getActiveSupabaseSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

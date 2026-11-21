import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';

export interface AuthenticatedPrincipal {
  uid: string;
  email: string;
  provider: 'firebase' | 'supabase';
  dbUserId: number;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedPrincipal;
}

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

const SUPABASE_URL = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL);
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  'sb_publishable_iBu2iCm5oUGdVTwLFlao7w_Hus2m5Uh';

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing bearer token' });
  }

  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Empty token' });
  }

  // 1. Try Firebase ID token verification (Google Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email || `${decoded.uid}@firebase.local`;
    const dbUser = await getOrCreateUser(`fb_${decoded.uid}`, email, 'firebase');
    req.user = {
      uid: dbUser.uid,
      email: dbUser.email,
      provider: 'firebase',
      dbUserId: dbUser.id,
    };
    return next();
  } catch {
    // Fallback to Supabase session token verification
  }

  // 2. Try Supabase Auth user verification (Email + Password)
  try {
    const sbRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_KEY,
      },
    });
    if (sbRes.ok) {
      const sbUser: any = await sbRes.json();
      if (sbUser?.id && sbUser?.email) {
        const dbUser = await getOrCreateUser(`sb_${sbUser.id}`, sbUser.email, 'supabase');
        req.user = {
          uid: dbUser.uid,
          email: dbUser.email,
          provider: 'supabase',
          dbUserId: dbUser.id,
        };
        return next();
      }
    }
  } catch (err) {
    console.error('Supabase token check failed:', err);
  }

  return res.status(401).json({ error: 'Unauthorized: Invalid or expired session token' });
};

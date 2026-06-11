import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { User, Session } from '@supabase/supabase-js';
import { customerSupabase, isStaffPath, staffSupabase } from '../lib/supabase';

export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  default_address: string;
  default_pincode: string;
  role: 'customer' | 'chef' | 'admin' | 'delivery';
}

const staffRoleMap = {
  'admin@gmail.com': {
    role: 'admin' as const,
  },
  'chef@gmail.com': {
    role: 'chef' as const,
  },
  'delivery@gmail.com': {
    role: 'delivery' as const,
  },
};

type AppSupabaseClient = typeof customerSupabase;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  sendOtp: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null; isNewUser: boolean; role: string | null }>;
  signInStaff: (email: string, password: string) => Promise<{ error: string | null; role: 'admin' | 'chef' | 'delivery' | null }>;
  completeProfile: (fullName: string, phone: string, email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const activeSupabase = isStaffPath(location.pathname) ? staffSupabase : customerSupabase;
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (
    client: AppSupabaseClient,
    userId: string,
  ): Promise<Profile | null> => {
    const { data } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile(data);
    return data;
  }, []);

  const clearAuthState = useCallback(() => {
    setSession(null);
    setUser(null);
    setProfile(null);
  }, []);

  const syncAuthState = useCallback(async (client: AppSupabaseClient) => {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();

    if (sessionError || !sessionData.session) {
      clearAuthState();
      return;
    }

    const activeSession = sessionData.session;
    const userId = activeSession.user?.id;

    if (!userId) {
      clearAuthState();
      return;
    }

    setSession(activeSession);
    setUser(activeSession.user);
    await fetchProfile(client, userId);
  }, [clearAuthState, fetchProfile]);

  useEffect(() => {
    let cancelled = false;
    clearAuthState();
    setLoading(true);

    void (async () => {
      await syncAuthState(activeSupabase);
      if (!cancelled) setLoading(false);
    })();

    const { data: { subscription } } = activeSupabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' || !nextSession?.user) {
        clearAuthState();
        if (!cancelled) setLoading(false);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setSession(nextSession);
        setUser(nextSession.user);
        const uid = nextSession.user.id;
        (async () => {
          await fetchProfile(activeSupabase, uid);
          if (!cancelled) setLoading(false);
        })();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [activeSupabase, clearAuthState, fetchProfile, syncAuthState]);

  const sendOtp = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await customerSupabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: true,
      },
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  const verifyOtp = async (email: string, token: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await customerSupabase.auth.verifyOtp({
      email: normalizedEmail,
      token,
      type: 'email',
    });
    if (error) return { error: error.message, isNewUser: false, role: null };

    if (data.user) {
      setSession(data.session ?? null);
      setUser(data.user);
      const profileData = await fetchProfile(customerSupabase, data.user.id);
      const role = profileData?.role || null;
      const isNewUser = !profileData || !profileData.full_name || !profileData.phone;
      return { error: null, isNewUser, role };
    }

    return { error: 'Verification failed', isNewUser: false, role: null };
  };

  const signInStaff = async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const staffAccess = staffRoleMap[normalizedEmail as keyof typeof staffRoleMap];

    if (!staffAccess) {
      return { error: 'Access denied. Authorized staff email required.', role: null };
    }

    await staffSupabase.auth.signOut();

    const { data, error } = await staffSupabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error || !data.user) {
      return {
        error: error?.message || 'Staff login failed.',
        role: null,
      };
    }

    const staffProfile = await fetchProfile(staffSupabase, data.user.id);
    if (!staffProfile || staffProfile.role !== staffAccess.role) {
      await staffSupabase.auth.signOut();
      clearAuthState();
      return {
        error: 'Access denied. Staff role is not configured correctly for this account.',
        role: null,
      };
    }

    setSession(data.session ?? null);
    setUser(data.user);
    return { error: null, role: staffProfile.role };
  };

  const completeProfile = async (fullName: string, phone: string, email: string) => {
    if (!user) return { error: 'Not authenticated' };
    const digits = phone.replace(/\D/g, '').slice(0, 10);

    const { error } = await activeSupabase.from('profiles').upsert({
      id: user.id,
      full_name: fullName,
      email,
      phone: digits,
    }, { onConflict: 'id' });

    if (error) return { error: error.message };

    await fetchProfile(activeSupabase, user.id);
    return { error: null };
  };

  const signOut = async () => {
    await activeSupabase.auth.signOut();
    clearAuthState();
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(activeSupabase, user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, sendOtp, verifyOtp, signInStaff, completeProfile, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

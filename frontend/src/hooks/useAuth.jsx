import { useState, useEffect, useContext, createContext } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch session — always resolve loading even if Supabase is misconfigured
    supabase.auth.getSession()
      .then(({ data }) => setSession(data?.session ?? null))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const normalizeEmail = (email) => (email || '').trim().toLowerCase();

  const getRedirectUrl = () => {
    if (typeof window === 'undefined') return undefined;
    return window.location.origin;
  };

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });
    if (error) throw new Error(error.message);
    setSession(data?.session ?? null);
    return data;
  };

  const loginWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getRedirectUrl(),
        queryParams: {
          prompt: 'select_account', // always show the account chooser
        },
      },
    });
    if (error) throw new Error(error.message);
    return data;
  };

  const signup = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: { emailRedirectTo: getRedirectUrl() },
    });
    if (error) throw new Error(error.message);
    setSession(data?.session ?? null);
    return data;
  };

  const resetPassword = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo: getRedirectUrl(),
    });
    if (error) throw new Error(error.message);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, login, loginWithGoogle, signup, resetPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

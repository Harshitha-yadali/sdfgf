import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Truck, Loader2, ArrowRight, Lock, Mail } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export default function DeliveryLogin() {
  const location = useLocation();
  const prefilled = (location.state as { email?: string } | null)?.email || '';
  const [email, setEmail] = useState(prefilled);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { profile, signInStaff } = useAuth();
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile && (profile.role === 'delivery' || profile.role === 'admin')) {
      navigate('/delivery', { replace: true });
    }
  }, [profile, navigate]);

  useEffect(() => {
    if (prefilled) {
      passwordRef.current?.focus();
    }
  }, [prefilled]);

  function normalizedEmail() {
    return email.trim().toLowerCase();
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const emailVal = normalizedEmail();
    if (!emailVal) {
      setError('Enter your delivery staff email address.');
      return;
    }

    setLoading(true);
    const { error: loginError, role } = await signInStaff(emailVal, password);
    setLoading(false);

    if (loginError) {
      setError(loginError);
      return;
    }

    if (role !== 'delivery' && role !== 'admin') {
      setError('Access denied. Delivery staff account required.');
      return;
    }

    navigate('/delivery', { replace: true });
  }

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-sky-500/20 to-sky-600/10 border border-sky-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-sky-500/10">
            <Truck size={38} className="text-sky-400" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Delivery Portal</h1>
          <p className="text-brand-text-dim text-sm mt-1.5 font-medium">The Supreme Waffle · Delivery Staff</p>
        </div>

        <form
          onSubmit={handleLogin}
          className="bg-brand-surface rounded-2xl p-6 border border-brand-border space-y-4 shadow-xl"
        >
          {error && (
            <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-xl border border-red-500/20 font-medium leading-snug">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[13px] font-semibold text-brand-text-dim mb-1.5">
              Email
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-text-dim pointer-events-none" />
              <input
                type="email"
                placeholder="delivery@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-brand-surface-light border border-brand-border rounded-xl pl-10 pr-3 py-3 text-sm text-white placeholder-brand-text-dim outline-none focus:border-sky-400 transition-colors"
                autoComplete="email"
                autoFocus={!prefilled}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-semibold text-brand-text-dim mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-text-dim pointer-events-none" />
              <input
                ref={passwordRef}
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-brand-surface-light border border-brand-border rounded-xl pl-10 pr-3 py-3 text-sm text-white placeholder-brand-text-dim outline-none focus:border-sky-400 transition-colors"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !normalizedEmail() || !password}
            className="w-full py-3.5 rounded-xl font-bold text-[15px] transition-all bg-sky-500 text-white hover:bg-sky-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20"
          >
            {loading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                Sign In
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <p className="text-center text-[12px] text-brand-text-dim mt-5">
          Staff access only — contact admin if you cannot log in
        </p>
      </div>
    </div>
  );
}
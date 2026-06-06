import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChefHat, Loader2, ArrowRight, Lock, Mail } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export default function ChefLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { profile, signInStaff } = useAuth();

  useEffect(() => {
    if (profile && (profile.role === 'chef' || profile.role === 'admin')) {
      navigate('/chef', { replace: true });
    }
  }, [profile, navigate]);

  function normalizedEmail() {
    return email.trim().toLowerCase();
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const emailVal = normalizedEmail();
    if (!emailVal) {
      setError('Enter your kitchen email address.');
      return;
    }

    setLoading(true);
    const { error: loginError, role } = await signInStaff(emailVal, password);
    setLoading(false);

    if (loginError) {
      setError(loginError);
      return;
    }

    if (role !== 'chef' && role !== 'admin') {
      setError('Access denied. Chef or admin account required.');
      return;
    }

    navigate('/chef', { replace: true });
  }

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo + title */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-orange-500/10">
            <ChefHat size={38} className="text-orange-400" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Kitchen Portal</h1>
          <p className="text-brand-text-dim text-sm mt-1.5 font-medium">The Supreme Waffle · Staff Access</p>
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
                placeholder="chef@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-brand-surface-light border border-brand-border rounded-xl pl-10 pr-3 py-3 text-sm text-white placeholder-brand-text-dim outline-none focus:border-orange-400 transition-colors"
                autoComplete="email"
                autoFocus
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
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-brand-surface-light border border-brand-border rounded-xl pl-10 pr-3 py-3 text-sm text-white placeholder-brand-text-dim outline-none focus:border-orange-400 transition-colors"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !normalizedEmail() || !password}
            className="w-full py-3.5 rounded-xl font-bold text-[15px] transition-all bg-orange-500 text-white hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
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

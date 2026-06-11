import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, Mail, ArrowLeft, Loader2, Phone, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';

type Step = 'email' | 'otp' | 'profile';

export default function AuthPage() {
  const [step, setStep] = useState<Step>('email');
  const [emailInput, setEmailInput] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [fullName, setFullName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const { sendOtp, verifyOtp, signInStaff, completeProfile, profile, user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const from = (location.state as { from?: string })?.from || '/';

  useEffect(() => {
    if (profile && profile.full_name && profile.phone) {
      if (profile.role === 'chef') {
        navigate('/chef', { replace: true });
      } else if (profile.role === 'admin') {
        navigate('/admin', { replace: true });
      } else if (profile.role === 'delivery') {
        navigate('/delivery', { replace: true });
      } else {
        navigate(from, { replace: true });
      }
      return;
    }

    if (profile && (!profile.full_name || !profile.phone)) {
      setStep('profile');
      setProfileEmail(profile.email || user?.email || emailInput);
      setProfilePhone(profile.phone || '');
    }
  }, [profile, user, emailInput, navigate, from]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  function normalizedEmail() {
    return emailInput.trim().toLowerCase();
  }

  const isStaffEmail = normalizedEmail() === 'admin@gmail.com' || normalizedEmail() === 'chef@gmail.com' || normalizedEmail() === 'delivery@gmail.com';

  async function handleSendOtp(e?: React.FormEvent) {
    e?.preventDefault();
    const email = normalizedEmail();
    if (!email || !email.includes('@')) {
      showToast('Please enter a valid Gmail address', 'error');
      return;
    }

    if (email === 'delivery@gmail.com') {
      navigate('/delivery/login', { replace: true, state: { email } });
      return;
    }

    if (email === 'admin@gmail.com' || email === 'chef@gmail.com') {
      if (!staffPassword) {
        showToast('Please enter the password', 'error');
        return;
      }

      setLoading(true);
      const { error, role } = await signInStaff(email, staffPassword);
      setLoading(false);

      if (error) {
        showToast(error, 'error');
        return;
      }

      if (role === 'admin') {
        navigate('/admin', { replace: true });
        return;
      }

      if (role === 'chef') {
        navigate('/chef', { replace: true });
        return;
      }

      return;
    }

    setLoading(true);
    const { error } = await sendOtp(email);
    setLoading(false);

    if (error) {
      showToast(error, 'error');
      return;
    }

    showToast('OTP sent to your email');
    setStep('otp');
    setResendTimer(30);
    setTimeout(() => otpRefs.current[0]?.focus(), 100);
  }

  function handleOtpChange(index: number, value: string) {
    if (value.length > 1) {
      const digits = value.replace(/\D/g, '').split('').slice(0, 6);
      const newOtp = [...otp];
      digits.forEach((d, i) => {
        if (index + i < 6) newOtp[index + i] = d;
      });
      setOtp(newOtp);
      const nextIdx = Math.min(index + digits.length, 5);
      otpRefs.current[nextIdx]?.focus();
      if (newOtp.every((d) => d !== '')) {
        void handleVerifyOtp(newOtp.join(''));
      }
      return;
    }

    const digit = value.replace(/\D/g, '');
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);

    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    if (newOtp.every((d) => d !== '')) {
      void handleVerifyOtp(newOtp.join(''));
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  async function handleVerifyOtp(token?: string) {
    const code = token || otp.join('');
    if (code.length !== 6) {
      showToast('Please enter the 6-digit OTP', 'error');
      return;
    }

    setLoading(true);
    const { error, isNewUser, role } = await verifyOtp(normalizedEmail(), code);
    setLoading(false);

    if (error) {
      showToast(error, 'error');
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
      return;
    }

    if (role === 'admin') {
      showToast('Welcome, Admin!');
      navigate('/admin', { replace: true });
      return;
    }
    if (role === 'chef') {
      showToast('Welcome, Chef!');
      navigate('/chef', { replace: true });
      return;
    }

    if (isNewUser) {
      setProfileEmail(normalizedEmail());
      setProfilePhone('');
      setStep('profile');
    } else {
      showToast('Welcome back!');
    }
  }

  async function handleCompleteProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      showToast('Please enter your name', 'error');
      return;
    }
    const digits = profilePhone.replace(/\D/g, '').slice(0, 10);
    if (digits.length !== 10) {
      showToast('Please enter a valid 10-digit mobile number', 'error');
      return;
    }

    setLoading(true);
    const { error } = await completeProfile(fullName.trim(), digits, profileEmail.trim().toLowerCase());
    setLoading(false);

    if (error) {
      showToast(error, 'error');
      return;
    }

    showToast('Account created successfully!');
  }

  async function handleResend() {
    if (resendTimer > 0) return;
    await handleSendOtp();
  }

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex justify-center mb-8">
          <img
            src="/image.png"
            alt="The Supreme Waffle"
            loading="eager"
            width={96}
            height={96}
            className="h-24 w-auto object-contain"
          />
        </Link>

        {step === 'email' && (
          <div className="animate-fade-in">
            <h1 className="text-2xl font-bold text-white text-center mb-1">Welcome</h1>
            <p className="text-brand-text-muted text-[14px] text-center mb-8">
              {isStaffEmail ? 'Direct staff access for admin and chef accounts' : 'Enter your Gmail to receive a login OTP'}
            </p>

            <div className="bg-brand-surface rounded-2xl border border-brand-border p-6">
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-[14px] font-semibold text-brand-text-muted mb-1.5">Gmail Address</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text-dim" />
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="you@gmail.com"
                      className="input-field pl-11"
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                </div>

                {isStaffEmail && (
                  <div>
                    <label className="block text-[14px] font-semibold text-brand-text-muted mb-1.5">Password</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text-dim" />
                      <input
                        type="password"
                        value={staffPassword}
                        onChange={(e) => setStaffPassword(e.target.value)}
                        placeholder={normalizedEmail() === 'admin@gmail.com' ? 'Enter admin password' : 'Enter chef password'}
                        className="input-field pl-11"
                        autoComplete="current-password"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !normalizedEmail() || (isStaffEmail && !staffPassword)}
                  className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3.5 mt-2"
                >
                  {loading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <>
                      {isStaffEmail ? 'Continue' : 'Send OTP'}
                      <ArrowRight size={18} strokeWidth={2.4} />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {step === 'otp' && (
          <div className="animate-fade-in">
            <button
              onClick={() => { setStep('email'); setOtp(['', '', '', '', '', '']); }}
              className="flex items-center gap-1.5 text-brand-text-dim text-[14px] mb-5 hover:text-white transition-colors"
            >
              <ArrowLeft size={16} />
              Change email
            </button>

            <h1 className="text-2xl font-bold text-white text-center mb-1">Verify OTP</h1>
            <p className="text-brand-text-muted text-[14px] text-center mb-8">
              Enter the 6-digit code sent to{' '}
              <span className="text-white font-semibold">{normalizedEmail()}</span>
            </p>

            <div className="bg-brand-surface rounded-2xl border border-brand-border p-6">
              <div className="flex justify-center gap-2.5 mb-6">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    onFocus={(e) => e.target.select()}
                    className="w-11 h-13 text-center text-xl font-bold rounded-xl bg-brand-surface-light border border-brand-border text-white focus:border-brand-gold focus:ring-1 focus:ring-brand-gold/30 outline-none transition-all"
                  />
                ))}
              </div>

              {loading && (
                <div className="flex justify-center mb-4">
                  <Loader2 size={24} className="animate-spin text-brand-gold" />
                </div>
              )}

              <div className="text-center">
                {resendTimer > 0 ? (
                  <p className="text-brand-text-dim text-[13px]">
                    Resend OTP in <span className="text-brand-gold font-semibold">{resendTimer}s</span>
                  </p>
                ) : (
                  <button
                    onClick={handleResend}
                    disabled={loading}
                    className="text-brand-gold text-[14px] font-semibold hover:underline underline-offset-2"
                  >
                    Resend OTP
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 'profile' && (
          <div className="animate-fade-in">
            <h1 className="text-2xl font-bold text-white text-center mb-1">Complete Your Profile</h1>
            <p className="text-brand-text-muted text-[14px] text-center mb-8">
              Just a few details to get started
            </p>

            <div className="bg-brand-surface rounded-2xl border border-brand-border p-6">
              <form onSubmit={handleCompleteProfile} className="space-y-4">
                <div>
                  <label className="block text-[14px] font-semibold text-brand-text-muted mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="input-field"
                    autoComplete="name"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-[14px] font-semibold text-brand-text-muted mb-1.5">Email</label>
                  <input
                    type="email"
                    value={profileEmail}
                    readOnly
                    className="input-field"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label className="block text-[14px] font-semibold text-brand-text-muted mb-1.5">Mobile Number</label>
                  <div className="relative">
                    <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text-dim" />
                    <input
                      type="tel"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="9876543210"
                      className="input-field pl-11"
                      autoComplete="tel"
                      inputMode="numeric"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !fullName.trim() || profilePhone.replace(/\D/g, '').length !== 10}
                  className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3.5 mt-2"
                >
                  {loading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <>
                      Get Started
                      <ArrowRight size={18} strokeWidth={2.4} />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

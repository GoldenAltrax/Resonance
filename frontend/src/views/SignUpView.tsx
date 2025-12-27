import { useState, FormEvent, useMemo } from 'react';
import { Music2, ArrowRight, ArrowLeft, Check, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { validatePassword, getPasswordStrength, isPasswordValid } from '@/utils/password';

interface SignUpViewProps {
  onSwitchToLogin: () => void;
  onBack: () => void;
}

const SignUpView = ({ onSwitchToLogin, onBack }: SignUpViewProps) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const { signup, isLoading, error, clearError } = useAuthStore();

  const passwordValidation = useMemo(() => validatePassword(password), [password]);
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordIsValid = useMemo(() => isPasswordValid(password), [password]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!username || !password || !inviteCode) return;

    // Validate password requirements
    if (!passwordIsValid) {
      setValidationError('Password does not meet all requirements');
      return;
    }

    // Validate password match
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setValidationError('Username can only contain letters, numbers, and underscores');
      return;
    }

    try {
      await signup(username, password, email || undefined, inviteCode);
    } catch {
      // Error is handled by the store
    }
  };

  const displayError = validationError || error;

  return (
    <div className="h-screen bg-[#0a0a0a] overflow-y-auto">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="fixed top-6 left-6 p-2.5 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition-all z-10"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="min-h-full flex items-center justify-center py-12 px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-6 shadow-xl">
            <Music2 className="text-zinc-400 w-7 h-7" />
          </div>
          <h2 className="text-2xl font-medium text-white tracking-tight">Create account</h2>
          <p className="text-zinc-500 text-sm mt-1">Join Resonance today</p>
        </div>

        {displayError && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-red-400 text-sm text-center">{displayError}</p>
            <button
              onClick={() => {
                setValidationError(null);
                clearError();
              }}
              className="text-red-400/60 text-xs mt-1 w-full text-center hover:text-red-400"
            >
              Dismiss
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-zinc-600 font-semibold px-1">
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. alex_resonance"
              className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-transparent transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-zinc-600 font-semibold px-1">
              Email <span className="text-zinc-700">(optional)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-transparent transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-zinc-600 font-semibold px-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-transparent transition-all"
            />

            {/* Password strength indicator */}
            {password && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        passwordStrength === 'strong' ? 'bg-green-500' :
                        passwordStrength === 'good' ? 'bg-yellow-500' :
                        passwordStrength === 'fair' ? 'bg-orange-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${
                        passwordStrength === 'strong' ? 100 :
                        passwordStrength === 'good' ? 75 :
                        passwordStrength === 'fair' ? 50 : 25
                      }%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium capitalize ${
                    passwordStrength === 'strong' ? 'text-green-500' :
                    passwordStrength === 'good' ? 'text-yellow-500' :
                    passwordStrength === 'fair' ? 'text-orange-500' : 'text-red-500'
                  }`}>
                    {passwordStrength}
                  </span>
                </div>

                {/* Requirements checklist */}
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div className={`flex items-center gap-1.5 ${passwordValidation.minLength ? 'text-green-500' : 'text-zinc-600'}`}>
                    {passwordValidation.minLength ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    8+ characters
                  </div>
                  <div className={`flex items-center gap-1.5 ${passwordValidation.hasUppercase ? 'text-green-500' : 'text-zinc-600'}`}>
                    {passwordValidation.hasUppercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    Uppercase letter
                  </div>
                  <div className={`flex items-center gap-1.5 ${passwordValidation.hasLowercase ? 'text-green-500' : 'text-zinc-600'}`}>
                    {passwordValidation.hasLowercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    Lowercase letter
                  </div>
                  <div className={`flex items-center gap-1.5 ${passwordValidation.hasNumber ? 'text-green-500' : 'text-zinc-600'}`}>
                    {passwordValidation.hasNumber ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    Number
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-zinc-600 font-semibold px-1">
              Confirm Password
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-transparent transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-zinc-600 font-semibold px-1">
              Invitation Code
            </label>
            <input
              type="text"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Enter your invitation code"
              className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-transparent transition-all"
            />
            <p className="text-[10px] text-zinc-600 px-1 mt-1">Ask the admin for an invitation code</p>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-6 bg-zinc-100 hover:bg-white text-black font-medium py-3 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-black" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating account...
              </span>
            ) : (
              <>
                Sign up
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

        <p className="text-center mt-8 text-zinc-500 text-sm">
          Already have an account?{' '}
          <button
            onClick={onSwitchToLogin}
            className="text-white hover:underline font-medium"
          >
            Log in
          </button>
        </p>

        <p className="text-center mt-6 text-zinc-600 text-xs">
          Resonance — Simply Music. Minimal Design. Pure Sound.
        </p>
      </div>
      </div>
    </div>
  );
};

export default SignUpView;

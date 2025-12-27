import { useState, FormEvent } from 'react';
import { Music2, ArrowRight, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

interface LoginViewProps {
  onSwitchToSignup: () => void;
  onBack: () => void;
}

const LoginView = ({ onSwitchToSignup, onBack }: LoginViewProps) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { login, isLoading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    try {
      await login(username, password);
      // Show full-screen animation after successful login
      setIsLoggingIn(true);
    } catch {
      // Error is handled by the store
    }
  };

  // Show logging in animation
  if (isLoggingIn) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#0a0a0a] flex flex-col items-center justify-center animate-in fade-in duration-500">
        <svg className="animate-spin h-10 w-10 text-zinc-500 mb-6" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <h2 className="text-xl font-light text-white tracking-widest uppercase">Logging in...</h2>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6 relative">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="absolute top-6 left-6 p-2.5 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition-all"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mb-6 shadow-xl">
            <Music2 className="text-zinc-400 w-7 h-7" />
          </div>
          <h2 className="text-2xl font-medium text-white tracking-tight">Welcome back</h2>
          <p className="text-zinc-500 text-sm mt-1">Please enter your details</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-red-400 text-sm text-center">{error}</p>
            <button
              onClick={clearError}
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
                Logging in...
              </span>
            ) : (
              <>
                Login
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

        <p className="text-center mt-8 text-zinc-500 text-sm">
          Don't have an account?{' '}
          <button
            onClick={onSwitchToSignup}
            className="text-white hover:underline font-medium"
          >
            Sign up
          </button>
        </p>

        <p className="text-center mt-6 text-zinc-600 text-xs">
          Resonance — Simply Music. Minimal Design. Pure Sound.
        </p>
      </div>
    </div>
  );
};

export default LoginView;

import { useEffect, useState } from 'react';
import { Music2 } from 'lucide-react';

interface LandingViewProps {
  onLogin: () => void;
  onSignUp: () => void;
}

const LandingView = ({ onLogin, onSignUp }: LandingViewProps) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Small delay for smooth entrance
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] flex flex-col items-center justify-center z-50 overflow-hidden">
      <div className={`transition-all duration-[1000ms] ease-out transform flex flex-col items-center ${
        isVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4'
      }`}>
        {/* Logo */}
        <div className="relative mb-8">
          <div className="absolute inset-0 bg-white/5 blur-3xl rounded-full scale-150" />
          <div className="w-20 h-20 border border-zinc-800 rounded-full flex items-center justify-center bg-[#0d0d0d] relative z-10 shadow-2xl">
            <Music2 className="text-zinc-300 w-10 h-10" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-4xl font-light tracking-[0.2em] text-white mb-2">RESONANCE</h1>
        <p className="text-sm font-light tracking-[0.4em] text-zinc-500 uppercase mb-12">Simply Music</p>

        {/* Buttons */}
        <div className="flex flex-col gap-4 w-64">
          <button
            onClick={onLogin}
            className="w-full py-3.5 px-6 bg-white text-black font-medium rounded-xl hover:bg-zinc-200 transition-all duration-300 transform hover:scale-[1.02]"
          >
            Log In
          </button>
          <button
            onClick={onSignUp}
            className="w-full py-3.5 px-6 bg-transparent text-white font-medium rounded-xl border border-zinc-700 hover:bg-zinc-800/50 hover:border-zinc-600 transition-all duration-300 transform hover:scale-[1.02]"
          >
            Sign Up
          </button>
        </div>
      </div>

      {/* Footer */}
      <p className="absolute bottom-8 text-zinc-600 text-xs tracking-widest">
        Minimal Design. Pure Sound.
      </p>
    </div>
  );
};

export default LandingView;

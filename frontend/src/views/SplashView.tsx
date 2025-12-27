
import { useEffect, useState } from 'react';
import { Music2 } from 'lucide-react';

const SplashView = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] flex flex-col items-center justify-center z-50 transition-opacity duration-1000 ease-in-out overflow-hidden">
      <div className={`transition-all duration-[2000ms] ease-out transform flex flex-col items-center ${
        isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
      }`}>
        <div className="relative mb-8">
            <div className="absolute inset-0 bg-white/5 blur-3xl rounded-full scale-150 animate-pulse" />
            <div className="w-20 h-20 border border-zinc-800 rounded-full flex items-center justify-center bg-[#0d0d0d] relative z-10 shadow-2xl">
                <Music2 className="text-zinc-300 w-10 h-10" />
            </div>
        </div>
        
        <h1 className="text-4xl font-light tracking-[0.2em] text-white mb-2">RESONANCE</h1>
        <p className="text-sm font-light tracking-[0.4em] text-zinc-500 uppercase">Simply Music</p>
      </div>

      <div className="absolute bottom-12 w-32 h-[1px] bg-zinc-800 overflow-hidden">
          <div className="h-full bg-zinc-400 w-1/3 animate-loading-slide" />
      </div>

      <style>{`
        @keyframes loading-slide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(300%); }
        }
        .animate-loading-slide {
            animation: loading-slide 3s infinite ease-in-out;
        }
      `}</style>
    </div>
  );
};

export default SplashView;

import { X, SlidersHorizontal } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';

const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_BAND_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

interface EqPreset {
  name: string;
  gains: number[];
}

const EQ_PRESETS: EqPreset[] = [
  { name: 'Flat',       gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Bass Boost', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'Treble Boost', gains: [0, 0, 0, 0, 0, 2, 3, 4, 5, 6] },
  { name: 'Vocal',      gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { name: 'Rock',       gains: [4, 3, 1, 0, -1, 0, 1, 3, 4, 4] },
  { name: 'Pop',        gains: [-1, 0, 2, 3, 4, 3, 2, 1, 0, -1] },
  { name: 'Jazz',       gains: [3, 2, 1, 0, -1, -1, 0, 1, 2, 3] },
  { name: 'Classical',  gains: [0, 0, 0, 0, 0, 0, -2, -3, -3, -4] },
];

const EqualizerPanel = () => {
  const { eqEnabled, eqGains, eqPreset, showEqualizer, toggleEq, toggleEqualizer, setEqGain, setEqPreset } =
    usePlayerStore();

  if (!showEqualizer) return null;

  return (
    <div className="fixed bottom-24 right-4 w-[420px] max-w-[95vw] bg-[#111] border border-zinc-800 rounded-2xl shadow-2xl z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-zinc-400" />
          <span className="text-white font-medium text-sm">Equalizer</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Enable/disable toggle */}
          <button
            onClick={toggleEq}
            aria-label={eqEnabled ? 'Disable EQ' : 'Enable EQ'}
            className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors ${
              eqEnabled ? 'bg-white' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block w-4 h-4 bg-black rounded-full shadow transition-transform ${
                eqEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <button
            onClick={toggleEqualizer}
            className="p-1 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Presets */}
      <div className="px-5 py-3 border-b border-zinc-800">
        <div className="flex flex-wrap gap-1.5">
          {EQ_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => setEqPreset(preset.name, preset.gains)}
              className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                eqPreset === preset.name
                  ? 'bg-white text-black font-medium'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Band sliders */}
      <div className="px-5 py-4">
        <div className="flex items-end justify-between gap-2">
          {EQ_BANDS.map((_, index) => (
            <div key={index} className="flex flex-col items-center gap-2 flex-1">
              {/* dB value */}
              <span className="text-[10px] text-zinc-500 tabular-nums w-7 text-center">
                {(eqGains[index] ?? 0) > 0 ? `+${eqGains[index]}` : (eqGains[index] ?? 0)}
              </span>
              {/* Vertical slider */}
              <div className="relative h-28 flex items-center justify-center">
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  value={eqGains[index] ?? 0}
                  onChange={(e) => setEqGain(index, parseFloat(e.target.value))}
                  disabled={!eqEnabled}
                  aria-label={`${EQ_BAND_LABELS[index]} Hz band`}
                  className={`appearance-none w-1 h-28 rounded-full cursor-pointer transition-opacity
                    [writing-mode:vertical-lr] [direction:rtl]
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-4
                    [&::-webkit-slider-thumb]:h-4
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-white
                    [&::-webkit-slider-thumb]:cursor-pointer
                    ${!eqEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  style={{
                    background: `linear-gradient(to top, white ${((eqGains[index] ?? 0) + 12) / 24 * 100}%, rgb(63 63 70) ${((eqGains[index] ?? 0) + 12) / 24 * 100}%)`,
                  }}
                />
              </div>
              {/* Hz label */}
              <span className="text-[10px] text-zinc-600">{EQ_BAND_LABELS[index]}</span>
            </div>
          ))}
        </div>
        {/* Scale markers */}
        <div className="flex justify-end mt-1">
          <div className="text-[10px] text-zinc-700 flex flex-col items-end leading-none">
            <span>+12 dB</span>
            <span className="mt-auto">−12 dB</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EqualizerPanel;

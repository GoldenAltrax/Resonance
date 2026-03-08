import { useNetworkStore } from '@/stores/networkStore';

const OfflineBanner = () => {
  const { isOnline, isServerReachable } = useNetworkStore();

  const showBanner = !isOnline || !isServerReachable;
  const message = !isOnline
    ? "You're offline — showing cached content"
    : "Server unreachable — some features may be unavailable";

  return (
    <div
      aria-live="polite"
      className={`fixed top-0 left-0 right-0 z-[100] flex items-center justify-center py-2 px-4 text-sm font-medium transition-all duration-500 ${
        showBanner
          ? 'opacity-100 translate-y-0 bg-amber-900/90 text-amber-200 backdrop-blur-sm'
          : 'opacity-0 -translate-y-full pointer-events-none'
      }`}
    >
      <span className="mr-2">⚠</span>
      {message}
    </div>
  );
};

export default OfflineBanner;

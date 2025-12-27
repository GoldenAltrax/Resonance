import { useState } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToastStore, Toast as ToastType, ToastType as ToastVariant } from '@/stores/toastStore';

const iconMap: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle className="w-5 h-5 text-green-400" />,
  error: <AlertCircle className="w-5 h-5 text-red-400" />,
  warning: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
  info: <Info className="w-5 h-5 text-blue-400" />,
};

const bgMap: Record<ToastVariant, string> = {
  success: 'bg-green-900/20 border-green-800/50',
  error: 'bg-red-900/20 border-red-800/50',
  warning: 'bg-yellow-900/20 border-yellow-800/50',
  info: 'bg-zinc-900 border-zinc-800',
};

const ToastItem = ({ toast }: { toast: ToastType }) => {
  const { removeToast } = useToastStore();
  const [isExiting, setIsExiting] = useState(false);

  const handleRemove = () => {
    setIsExiting(true);
    setTimeout(() => removeToast(toast.id), 200);
  };

  // Use role="alert" for error/warning (important, interrupts), role="status" for success/info (polite)
  const role = toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status';
  const ariaLive = toast.type === 'error' || toast.type === 'warning' ? 'assertive' : 'polite';

  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-sm transition-all duration-200 ${
        bgMap[toast.type]
      } ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}
    >
      {iconMap[toast.type]}
      <p className="flex-1 text-sm text-white">{toast.message}</p>
      <button
        onClick={handleRemove}
        aria-label="Dismiss notification"
        className="p-1 text-zinc-500 hover:text-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export const ToastContainer = () => {
  const { toasts } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
};

export default ToastContainer;

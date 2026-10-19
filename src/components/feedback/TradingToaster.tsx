import { useEffect } from 'react';
import { useTradingStore } from '@/features/trading/stores/useTradingStore';
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function TradingToaster() {
  const { notifications, dismissNotification } = useTradingStore();

  useEffect(() => {
    if (notifications.length === 0) return;

    // Auto dismiss oldest notification after 4.5 seconds
    const timer = setTimeout(() => {
      const oldest = notifications[notifications.length - 1];
      if (oldest) {
        dismissNotification(oldest.id);
      }
    }, 4500);

    return () => clearTimeout(timer);
  }, [notifications, dismissNotification]);

  if (notifications.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
    >
      {notifications.slice(0, 4).map((notif) => {
        const isSuccess = notif.type === 'success';
        const isError = notif.type === 'error';
        const isWarning = notif.type === 'warning';

        return (
          <div
            key={notif.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-2 duration-200 select-none',
              isSuccess && 'bg-[#0a1914]/95 border-emerald-500/40 text-emerald-200 shadow-emerald-950/40',
              isError && 'bg-[#1c0d12]/95 border-rose-500/40 text-rose-200 shadow-rose-950/40',
              isWarning && 'bg-[#1c160a]/95 border-amber-500/40 text-amber-200 shadow-amber-950/40',
              notif.type === 'info' && 'bg-[#091524]/95 border-cyan-500/40 text-cyan-200 shadow-cyan-950/40'
            )}
          >
            <div className="shrink-0 mt-0.5">
              {isSuccess && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              {isError && <AlertCircle className="h-4 w-4 text-rose-400" />}
              {isWarning && <AlertTriangle className="h-4 w-4 text-amber-400" />}
              {notif.type === 'info' && <Info className="h-4 w-4 text-cyan-400" />}
            </div>

            <div className="flex-1 min-w-0">
              <h5 className="text-xs font-semibold tracking-tight text-white">{notif.title}</h5>
              <p className="text-[11px] text-slate-300 mt-0.5 font-mono leading-relaxed break-words">
                {notif.message}
              </p>
            </div>

            <button
              onClick={() => dismissNotification(notif.id)}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:text-white transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

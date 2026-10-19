import { ConnectionStatus } from '@/types/market';
import { cn } from '@/lib/utils';
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react';

interface StatusIndicatorProps {
  status: ConnectionStatus;
  latencyMs?: number;
  className?: string;
}

export function StatusIndicator({ status, latencyMs = 24, className }: StatusIndicatorProps) {
  const config = {
    connected: {
      color: 'bg-emerald-500',
      text: 'Live Feed',
      textColor: 'text-emerald-400',
      icon: Wifi,
    },
    connecting: {
      color: 'bg-amber-500 animate-pulse',
      text: 'Connecting...',
      textColor: 'text-amber-400',
      icon: Wifi,
    },
    stale: {
      color: 'bg-amber-600 animate-pulse-subtle',
      text: 'Stale Feed',
      textColor: 'text-amber-400',
      icon: AlertTriangle,
    },
    disconnected: {
      color: 'bg-rose-500',
      text: 'Disconnected',
      textColor: 'text-rose-400',
      icon: WifiOff,
    },
    simulated: {
      color: 'bg-indigo-400 animate-pulse-subtle',
      text: 'Simulated Engine',
      textColor: 'text-indigo-400',
      icon: Wifi,
    },
  }[status];

  const Icon = config.icon;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-[#232c3f] bg-[#0c101a] px-2.5 py-1 text-[11px] select-none',
        className
      )}
      title={`Connection: ${config.text} (${latencyMs}ms)`}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-75',
            config.color
          )}
        />
        <span
          className={cn('relative inline-flex h-2 w-2 rounded-full', config.color)}
        />
      </span>
      <span className={cn('font-medium', config.textColor)}>
        {config.text}
      </span>
      {status === 'connected' && latencyMs > 0 && (
        <span className="font-mono text-[10px] text-slate-400 tabular-nums">
          Latency: {latencyMs}ms
        </span>
      )}
      <Icon className="h-3 w-3 text-slate-500" />
    </div>
  );
}

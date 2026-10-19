import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[#1e273a] text-slate-300 border border-[#2c3852]',
        secondary: 'bg-slate-800 text-slate-300',
        buy: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
        sell: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
        warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
        accent: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
        simulated: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

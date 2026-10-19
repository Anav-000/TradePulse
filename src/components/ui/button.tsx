import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500 disabled:pointer-events-none disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        default: 'bg-cyan-600 text-white hover:bg-cyan-500 active:bg-cyan-700 shadow-sm',
        secondary: 'bg-[#1e273a] text-slate-200 hover:bg-[#28354d] active:bg-[#1a2334]',
        outline: 'border border-[#232c3f] bg-transparent text-slate-300 hover:bg-[#151b2a] hover:text-white',
        ghost: 'text-slate-400 hover:bg-[#151b2a] hover:text-slate-200',
        buy: 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700 font-semibold shadow-sm shadow-emerald-950',
        sell: 'bg-rose-600 text-white hover:bg-rose-500 active:bg-rose-700 font-semibold shadow-sm shadow-rose-950',
        subtleBuy: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20',
        subtleSell: 'bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20',
      },
      size: {
        default: 'h-8 px-3 py-1.5',
        sm: 'h-7 px-2.5 text-[11px]',
        lg: 'h-10 px-4 text-sm',
        icon: 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

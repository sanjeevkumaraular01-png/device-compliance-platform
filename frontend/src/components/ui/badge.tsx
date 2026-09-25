import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { toneBadge, type Tone } from "@/lib/status";

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset transition-colors [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground ring-transparent",
        secondary: "bg-secondary text-secondary-foreground ring-border",
        outline: "bg-transparent text-foreground ring-border",
        destructive: "bg-destructive text-destructive-foreground ring-transparent",
        tone: "",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  tone?: Tone;
  dot?: boolean;
}

function Badge({ className, variant, tone, dot, children, ...props }: BadgeProps) {
  const toneCls = tone ? toneBadge[tone] : undefined;
  return (
    <span className={cn(badgeVariants({ variant: tone ? "tone" : variant }), toneCls, className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };

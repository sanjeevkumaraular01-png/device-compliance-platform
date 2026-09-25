import * as React from "react";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Card with a title row (title, description, right-aligned action) used by dashboard-style widgets. */
export function WidgetCard({
  title,
  description,
  action,
  icon: Icon,
  className,
  contentClassName,
  children,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <Card id={id} className={cn("flex min-w-0 flex-col", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 p-4 pb-2">
        <div className="flex min-w-0 items-start gap-2">
          {Icon && <Icon className="mt-px size-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <CardTitle className="leading-5">{title}</CardTitle>
            {description && <CardDescription className="mt-0.5">{description}</CardDescription>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <CardContent className={cn("min-w-0 flex-1", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

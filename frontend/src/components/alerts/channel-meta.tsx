import type * as React from "react";
import { Mail, MessageCircle, MessageSquareText, Slack, Users, Webhook } from "lucide-react";
import type { AlertChannelType } from "@/types/api";

export const channelTypeMeta: Record<AlertChannelType, { label: string; icon: React.ComponentType<{ className?: string }>; description: string }> = {
  EMAIL: { label: "Email", icon: Mail, description: "SMTP email to one or more recipients" },
  SMS: { label: "SMS", icon: MessageSquareText, description: "Text message via Twilio" },
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle, description: "WhatsApp message via Twilio" },
  SLACK: { label: "Slack", icon: Slack, description: "Slack incoming webhook" },
  TEAMS: { label: "Microsoft Teams", icon: Users, description: "Teams incoming webhook" },
  WEBHOOK: { label: "Webhook", icon: Webhook, description: "JSON POST signed with HMAC-SHA256 (X-SEM-Signature)" },
};

export function ChannelTypeIcon({ type, className }: { type: AlertChannelType; className?: string }) {
  const Icon = channelTypeMeta[type]?.icon ?? Webhook;
  return <Icon className={className} />;
}

/** Render a masked config value returned by the API into a short display string. */
export function maskedValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** One-line summary of a channel's (masked) destination. */
export function channelDestination(type: AlertChannelType, config: Record<string, unknown> | null): string {
  if (!config) return "";
  switch (type) {
    case "EMAIL":
      return maskedValue(config.recipients);
    case "SMS":
    case "WHATSAPP":
      return maskedValue(config.to);
    case "SLACK":
    case "TEAMS":
      return maskedValue(config.webhookUrl);
    case "WEBHOOK":
      return maskedValue(config.url);
    default:
      return "";
  }
}

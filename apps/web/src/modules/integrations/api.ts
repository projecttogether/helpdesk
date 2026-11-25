import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CheckResult } from "@helpdesk/shared/api/common";
import type {
  Delivery,
  EmailSettings,
  EmailSettingsInput,
  SlackSettings,
  SlackSettingsInput,
} from "@helpdesk/shared/api/integrations";
import type { IamSettings, IamSettingsInput } from "@helpdesk/shared/api/identity";
import { api } from "@/lib/api";
import { meQuery } from "@/hooks/use-me";

export type SlackChannel = { id: string; name: string; isPrivate: boolean; isMember: boolean };

export const integrationKeys = {
  email: ["integrations", "email"] as const,
  iam: ["integrations", "iam"] as const,
  slack: ["integrations", "slack"] as const,
  channels: ["integrations", "slack", "channels"] as const,
  deliveries: ["integrations", "deliveries"] as const,
  deliveryPage: (limit: number, offset: number) => ["integrations", "deliveries", { limit, offset }] as const,
};

export function useEmailSettings() {
  return useQuery({
    queryKey: integrationKeys.email,
    queryFn: ({ signal }) => api.get<EmailSettings>("/integrations/email", undefined, signal),
  });
}

export function useSaveEmail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EmailSettingsInput) => api.put<EmailSettings>("/integrations/email", input),
    onSuccess: (settings) => client.setQueryData(integrationKeys.email, settings),
  });
}

/** Sends a test email with the saved settings. */
export function useTestEmail() {
  return useMutation({
    mutationFn: (to: string) => api.post<CheckResult>("/integrations/email/test", { to }),
  });
}

export function useSlackSettings() {
  return useQuery({
    queryKey: integrationKeys.slack,
    queryFn: ({ signal }) => api.get<SlackSettings>("/integrations/slack", undefined, signal),
  });
}

export function useSaveSlack() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SlackSettingsInput) => api.put<SlackSettings>("/integrations/slack", input),
    onSuccess: (settings) => {
      client.setQueryData(integrationKeys.slack, settings);
      return Promise.all([
        client.invalidateQueries({ queryKey: integrationKeys.channels }),
        // Whether staff can choose Slack direct messages.
        client.invalidateQueries({ queryKey: meQuery.queryKey }),
      ]);
    },
  });
}

/**
 * Channels the bot can see. Fails with 409 when Slack isn't connected or
 * the token lacks channels:read / groups:read: then enter the ID instead.
 */
export function useSlackChannels(enabled: boolean) {
  return useQuery({
    queryKey: integrationKeys.channels,
    queryFn: ({ signal }) =>
      api.get<{ items: SlackChannel[] }>("/integrations/slack/channels", undefined, signal),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** Posts a test message to the saved channel. */
export function useTestSlack() {
  return useMutation({ mutationFn: () => api.post<CheckResult>("/integrations/slack/test") });
}

export function useDeliveries(limit: number, offset: number) {
  return useQuery({
    queryKey: integrationKeys.deliveryPage(limit, offset),
    queryFn: ({ signal }) =>
      api.get<{ items: Delivery[]; total: number }>("/integrations/deliveries", { limit, offset }, signal),
    placeholderData: keepPreviousData,
    // Follow messages on their way out.
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === "pending" || item.status === "sending")
        ? 5_000
        : false,
  });
}

export function useIamSettings() {
  return useQuery({
    queryKey: integrationKeys.iam,
    queryFn: ({ signal }) => api.get<IamSettings>("/integrations/iam", undefined, signal),
  });
}

export function useSaveIam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: IamSettingsInput) => api.put<IamSettings>("/integrations/iam", input),
    onSuccess: (settings) => {
      client.setQueryData(integrationKeys.iam, settings);
      // Whether tickets offer "Request identity".
      return Promise.all([
        client.invalidateQueries({ queryKey: ["identity-options"] }),
        client.invalidateQueries({ queryKey: meQuery.queryKey }),
      ]);
    },
  });
}

/** Asks IAM, with the saved settings, which person types it accepts. */
export function useTestIam() {
  return useMutation({ mutationFn: () => api.post<CheckResult>("/integrations/iam/test") });
}

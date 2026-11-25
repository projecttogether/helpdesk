import { useId } from "react";
import { Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { About, Me } from "@helpdesk/shared/api/users";
import type { NotifyChannel } from "@helpdesk/shared/roles";
import { Page, PageHeader } from "@/components/ui/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AboutCard, AppearanceCard, KeyboardShortcutsCard } from "@/components/ui/settings-cards";
import { OrganizationLogo } from "@/components/brand";
import { useHasRole, useMe } from "@/hooks/use-me";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { api, errorMessage } from "@/lib/api";
import { useRoleLabel } from "@/lib/labels";
import { commitUrl, REPOSITORY_URL } from "@/lib/repository";
import { useTheme } from "@/lib/theme";
import { useUpdateMe } from "./api";
import { messages } from "./messages";

/** One choice of a radio group, as a bordered card with a title and a hint. */
function Choice(props: { id: string; value: string; title: string; hint?: string; disabled?: boolean }) {
  return (
    <FieldLabel htmlFor={props.id}>
      <Field orientation="horizontal" data-disabled={props.disabled ? true : undefined}>
        <RadioGroupItem value={props.value} id={props.id} disabled={props.disabled} />
        <FieldContent>
          <FieldTitle>{props.title}</FieldTitle>
          {props.hint ? <FieldDescription>{props.hint}</FieldDescription> : null}
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

function AccountCard({ me }: { me: Me }) {
  const t = useT(messages);
  const roleLabel = useRoleLabel();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("account")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-muted-foreground">{t("name")}</dt>
          <dd className="min-w-0 break-words">{me.name}</dd>
          <dt className="text-muted-foreground">{t("email")}</dt>
          <dd className="min-w-0 break-all">{me.email}</dd>
          <dt className="text-muted-foreground">{t("role")}</dt>
          <dd>{roleLabel(me.role)}</dd>
        </dl>
        <p className="text-muted-foreground flex gap-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("accountHint")}</span>
        </p>
      </CardContent>
    </Card>
  );
}

function NotificationsCard({ me }: { me: Me }) {
  const t = useT(messages);
  const tc = useT(common);
  const id = useId();
  const update = useUpdateMe();
  const value = (update.isPending ? update.variables.notifyVia : undefined) ?? me.notifyVia;

  const choose = (notifyVia: NotifyChannel) => {
    if (notifyVia === me.notifyVia) return;
    update.mutate(
      { notifyVia },
      {
        onSuccess: () => toast.success(tc("saved")),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("notifications")}</h2>
        </CardTitle>
        <CardDescription id={`${id}-question`}>{t("notifyQuestion")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <RadioGroup
          value={value}
          onValueChange={(next) => choose(next as NotifyChannel)}
          aria-labelledby={`${id}-question`}
          disabled={update.isPending}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Choice
            id={`${id}-email`}
            value="email"
            title={t("notifyEmail")}
            hint={t("notifyEmailHint", { email: me.email })}
          />
          <Choice
            id={`${id}-slack`}
            value="slack"
            title={t("notifySlack")}
            hint={me.slackAvailable ? t("notifySlackHint") : t("slackUnavailable")}
            disabled={!me.slackAvailable && me.notifyVia !== "slack"}
          />
        </RadioGroup>
        {me.notifyVia === "slack" && !me.slackAvailable ? (
          <p className="text-muted-foreground flex gap-2 text-sm" role="status">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("slackFallback")}</span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RequesterNote() {
  const t = useT(messages);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("notifications")}</h2>
        </CardTitle>
        <CardDescription>{t("requesterNote")}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function SettingsPage() {
  const t = useT(messages);
  const me = useMe();
  const staff = useHasRole("operator");
  const superadmin = useHasRole("superadmin");
  const { theme, setTheme } = useTheme();
  // The version that runs: superadmins only, as before on the Updates page.
  const about = useQuery({
    queryKey: ["about"],
    queryFn: () => api.get<About>("/about"),
    enabled: superadmin,
  }).data;
  const version = superadmin ? about?.version : undefined;
  return (
    <Page className="max-w-3xl">
      <PageHeader title={t("title")} description={t("description")} />
      <AccountCard me={me} />
      {staff ? <NotificationsCard me={me} /> : <RequesterNote />}
      <AppearanceCard value={theme} onChange={setTheme} />
      <KeyboardShortcutsCard />
      {/* The software's name, also when an installation renames the app. */}
      <AboutCard
        logo={<OrganizationLogo className="size-10 rounded-md" />}
        text={t("about")}
        version={version}
        versionHref={version ? commitUrl(version) : undefined}
        repositoryUrl={REPOSITORY_URL}
      />
    </Page>
  );
}

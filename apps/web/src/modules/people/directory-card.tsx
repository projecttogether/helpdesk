import { useState } from "react";
import { toast } from "sonner";
import { Info, PlugZap, RefreshCw } from "lucide-react";
import type { CheckResult } from "@helpdesk/shared/api/common";
import type { DirectoryStatus } from "@helpdesk/shared/api/integrations";
import { ROLES } from "@helpdesk/shared/roles";
import { CheckResultAlert } from "@/components/check-result";
import { ErrorState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useHasRole } from "@/hooks/use-me";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useFormatter } from "@/lib/format";
import { useRoleLabel } from "@/lib/labels";
import { useCheckDirectory, useDirectory, useSyncDirectory } from "./api";
import { messages } from "./messages";

/** Where roles come from, in plain words. */
export function useModeText() {
  const t = useT(messages);
  return (status: DirectoryStatus) =>
    status.mode === "oidc"
      ? t("modeOidc")
      : status.syncMinutes
        ? t("modeKeycloak", { minutes: status.syncMinutes })
        : t("modeKeycloakNoInterval");
}

function LastSync({ lastSync }: { lastSync: DirectoryStatus["lastSync"] }) {
  const t = useT(messages);
  const format = useFormatter();
  if (!lastSync) return <span className="text-muted-foreground">{t("neverSynced")}</span>;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <time dateTime={lastSync.at} title={format.dateTime(lastSync.at)}>
          {format.relative(lastSync.at)}
        </time>
        <Badge variant={lastSync.ok ? "secondary" : "destructive"}>
          {lastSync.ok ? t("syncOk") : t("syncFailed")}
        </Badge>
        {lastSync.ok ? (
          <span className="text-muted-foreground">{t("syncPeople", { count: lastSync.people })}</span>
        ) : null}
      </div>
      {lastSync.message ? <p className="text-muted-foreground break-words">{lastSync.message}</p> : null}
    </div>
  );
}

/** Superadmins with Keycloak: check the service account and sync now. */
function DirectoryActions(props: { onResult: (result: { label: string; result: CheckResult }) => void }) {
  const t = useT(messages);
  const check = useCheckDirectory();
  const sync = useSyncDirectory();
  const busy = check.isPending || sync.isPending;

  const run = async (action: () => Promise<CheckResult>, label: string) => {
    try {
      props.onResult({ label, result: await action() });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void run(() => check.mutateAsync(), t("checkResult"))}
      >
        {check.isPending ? <Spinner /> : <PlugZap />}
        {t("check")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void run(() => sync.mutateAsync(), t("syncResult"))}
      >
        {sync.isPending ? <Spinner /> : <RefreshCw />}
        {t("sync")}
      </Button>
    </div>
  );
}

export function DirectoryCard() {
  const t = useT(messages);
  const roleLabel = useRoleLabel();
  const modeText = useModeText();
  const isSuperadmin = useHasRole("superadmin");
  const directory = useDirectory();
  const [result, setResult] = useState<{ label: string; result: CheckResult } | null>(null);
  const status = directory.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("directory")}</h2>
        </CardTitle>
        <CardDescription>
          {status ? modeText(status) : directory.isLoading ? <Skeleton className="h-4 w-2/3" /> : null}
        </CardDescription>
        {status?.mode === "keycloak" && isSuperadmin ? (
          <CardAction>
            <DirectoryActions onResult={setResult} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {directory.isError ? (
          <ErrorState error={directory.error} onRetry={() => void directory.refetch()} />
        ) : status ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <section className="grid gap-2" aria-labelledby="directory-groups">
                <h3 id="directory-groups" className="font-medium">
                  {t("groups")}
                </h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {ROLES.map((role) => (
                    <div key={role} className="contents">
                      <dt className="text-muted-foreground">{roleLabel(role)}</dt>
                      <dd className="min-w-0 break-all">
                        {status.groups[role] ? (
                          <code className="font-mono text-xs">{status.groups[role]}</code>
                        ) : (
                          <span className="text-muted-foreground">{t("noGroup")}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              {status.mode === "keycloak" || status.lastSync ? (
                <section className="grid content-start gap-2" aria-labelledby="directory-sync">
                  <h3 id="directory-sync" className="font-medium">
                    {t("lastSync")}
                  </h3>
                  <LastSync lastSync={status.lastSync} />
                </section>
              ) : null}
            </div>
            {result ? (
              <div className="grid gap-1">
                <p className="text-muted-foreground text-xs font-medium">{result.label}</p>
                <CheckResultAlert result={result.result} />
              </div>
            ) : null}
            <p className="text-muted-foreground flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t("changeRoles")}</span>
            </p>
          </>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </CardContent>
    </Card>
  );
}

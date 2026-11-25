import { useState } from "react";
import { Search, UsersRound } from "lucide-react";
import type { User } from "@helpdesk/shared/api/users";
import { Page, PageHeader } from "@/components/ui/page";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebounced } from "@/hooks/use-debounced";
import { useT } from "@/i18n";
import { useFormatter } from "@/lib/format";
import { useRoleLabel } from "@/lib/labels";
import { useDirectory, useUsers, type Access } from "./api";
import { DirectoryCard } from "./directory-card";
import { messages } from "./messages";

export const ACCESS: Access[] = ["with", "without", "all"];

function When({ iso }: { iso: string | null }) {
  const format = useFormatter();
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={iso} title={format.dateTime(iso)}>
      {format.relative(iso)}
    </time>
  );
}

function RoleSource({ user }: { user: User }) {
  const t = useT(messages);
  if (user.fromEnvironment || user.roleSource === "environment") {
    return (
      <span title={t("environmentHint")}>
        <code className="font-mono text-xs">{t("sourceEnvironment")}</code>
      </span>
    );
  }
  if (user.roleSource === "directory") return <>{t("sourceDirectory")}</>;
  if (user.roleSource === "sign_in") return <>{t("sourceSignIn")}</>;
  return <span className="text-muted-foreground">—</span>;
}

function UsersTable({ users }: { users: User[] }) {
  const t = useT(messages);
  const roleLabel = useRoleLabel();
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colName")}</TableHead>
            <TableHead>{t("colEmail")}</TableHead>
            <TableHead>{t("colRole")}</TableHead>
            <TableHead>{t("colSource")}</TableHead>
            <TableHead>{t("colLastSignIn")}</TableHead>
            <TableHead>{t("colChecked")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name.trim() || "—"}</TableCell>
              <TableCell className="break-all whitespace-normal">{user.email}</TableCell>
              <TableCell>
                <Badge
                  variant={user.role ? "secondary" : "outline"}
                  className={user.role ? undefined : "text-muted-foreground"}
                >
                  {roleLabel(user.role)}
                </Badge>
              </TableCell>
              <TableCell>
                <RoleSource user={user} />
              </TableCell>
              <TableCell>
                <When iso={user.lastSignInAt} />
              </TableCell>
              <TableCell>
                <When iso={user.roleCheckedAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export function PeoplePage(props: { access: Access; onAccess: (access: Access) => void }) {
  const t = useT(messages);
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const users = useUsers(props.access, q);
  const mode = useDirectory().data?.mode;
  const accessLabel: Record<Access, string> = {
    with: t("accessWith"),
    without: t("accessWithout"),
    all: t("accessAll"),
  };
  const emptyTitle: Record<Access, string> = {
    with: t("emptyWith"),
    without: t("emptyWithout"),
    all: t("emptyAll"),
  };

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <DirectoryCard />
      <Tabs value={props.access} onValueChange={(value) => props.onAccess(value as Access)} className="gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList aria-label={t("accessLabel")}>
            {ACCESS.map((access) => (
              <TabsTrigger key={access} value={access}>
                {accessLabel[access]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="relative sm:w-72">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              className="pl-8"
              aria-label={t("search")}
              placeholder={t("search")}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
        </div>
        <TabsContent value={props.access}>
          {users.isLoading ? (
            <LoadingState />
          ) : users.isError || !users.data ? (
            <ErrorState error={users.error} onRetry={() => void users.refetch()} />
          ) : users.data.items.length === 0 ? (
            <EmptyState
              icon={<UsersRound />}
              title={q ? t("emptySearch", { q }) : emptyTitle[props.access]}
              description={
                q || props.access === "without"
                  ? undefined
                  : mode === "keycloak"
                    ? t("emptyKeycloak")
                    : mode === "oidc"
                      ? t("emptyOidc")
                      : undefined
              }
            />
          ) : (
            <UsersTable users={users.data.items} />
          )}
        </TabsContent>
      </Tabs>
    </Page>
  );
}

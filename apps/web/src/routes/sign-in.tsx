import { useState } from "react";
import { createRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { LogIn } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SignInPage as SignInLayout } from "@/components/ui/sign-in-page";
import { Spinner } from "@/components/ui/spinner";
import { AppIcon, MadeBy } from "@/components/brand";
import { authClient } from "@/lib/auth-client";
import { useAuthConfig } from "@/lib/auth-config";
import { apiUrl } from "@/lib/api";
import { defineMessages, useT } from "@/i18n";
import { rootRoute } from "./root";

const messages = defineMessages({
  en: {
    description: "Send requests and follow them up.",
    signInWith: "Sign in with {name}",
    signInSso: "Sign in",
    noAccess: "This account has no access. Ask your IT team to add you to a helpdesk group.",
    failed: "Sign-in failed. Try again.",
  },
});

const searchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

/** Only same-site paths, never another origin. */
export function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/sign-in")
    ? target
    : "/";
}

function SignInPage() {
  const t = useT(messages);
  const config = useAuthConfig();
  const search = signInRoute.useSearch();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const appName = config?.appName || "Helpdesk";

  const signIn = async () => {
    setPending(true);
    setFailed(false);
    // Better Auth 1.7 serves generic OAuth providers through the social sign-in.
    const result = await authClient.signIn.social({
      provider: "oidc",
      callbackURL: safeRedirect(search.redirect),
      errorCallbackURL: "/sign-in",
    });
    // On success the browser leaves for the identity provider.
    if (result.error) {
      setPending(false);
      setFailed(true);
    }
  };

  return (
    <SignInLayout
      app={{ name: appName, icon: <AppIcon className="size-9" /> }}
      tagline={t("description")}
      footer={<MadeBy appName={appName} />}
    >
      {search.error ? (
        <Alert variant="destructive">
          <AlertDescription>{t("noAccess")}</AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>{t("failed")}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="button" onClick={() => void signIn()} disabled={pending}>
        {pending ? <Spinner /> : <LogIn />}
        {config ? t("signInWith", { name: config.providerName }) : t("signInSso")}
      </Button>
    </SignInLayout>
  );
}

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    // Signed in already: go on to the app. A plain request, so a 401 doesn't trigger the sign-out handling.
    const response = await fetch(apiUrl("/me"), {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    }).catch(() => null);
    if (response?.ok) throw redirect({ to: safeRedirect(search.redirect) });
  },
  component: SignInPage,
});

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/ui/page";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { queryClient } from "@/lib/query";
import { translate, useT } from "@/i18n";
import { formQuery } from "./api";
import { FormRunner } from "./form-runner";
import { formMessages, messages } from "./messages";

export function NewRequestPage() {
  const t = useT(messages);
  const navigate = useNavigate();
  const form = useQuery({ ...formQuery, staleTime: Infinity, refetchOnWindowFocus: false });

  return (
    <Page className="max-w-3xl">
      <PageHeader title={form.data?.definition.title ?? t("newRequest")} />
      {form.isPending ? (
        <LoadingState />
      ) : form.isError ? (
        <ErrorState error={form.error} onRetry={() => void form.refetch()} />
      ) : (
        <FormRunner
          // A new version of the form starts a fresh run.
          key={form.data.versionId}
          form={form.data}
          onSent={(number) => {
            toast.success(translate(formMessages, form.data.definition.language)("sent", { number }));
            void queryClient.invalidateQueries({ queryKey: ["requests"] });
            void navigate({ to: "/requests/$number", params: { number: String(number) } });
          }}
        />
      )}
    </Page>
  );
}

import { Page, PageHeader } from "@/components/ui/page";
import { useT } from "@/i18n";
import { DeliveriesCard } from "./deliveries-card";
import { EmailCard } from "./email-card";
import { IamCard } from "./iam-card";
import { messages } from "./messages";
import { SlackCard } from "./slack-card";

export function IntegrationsPage() {
  const t = useT(messages);
  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <EmailCard />
      <SlackCard />
      <IamCard />
      <DeliveriesCard />
    </Page>
  );
}

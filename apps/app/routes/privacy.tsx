import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { useTranslations } from "@/i18n/use-translations";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  const { t } = useTranslations();

  return (
    <LegalDocumentPage
      title={t.legal.privacyTitle}
      sections={t.legal.privacyBody}
    />
  );
}

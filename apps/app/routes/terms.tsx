import { LegalDocumentPage } from "@/components/legal/legal-document-page";
import { useTranslations } from "@/i18n/use-translations";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  const { t } = useTranslations();

  return (
    <LegalDocumentPage
      title={t.legal.termsTitle}
      sections={t.legal.termsBody}
    />
  );
}

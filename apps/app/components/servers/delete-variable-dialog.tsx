import { useDeleteMcpVariable } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { templateReferencesName } from "@/lib/value-origin";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";

export type VariableReferenceTool = {
  name: string;
  pathTemplate: string;
  requestTemplate: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string | null;
  } | null;
};

export type VariableReferenceDetails = {
  toolNames: string[];
  defaultHeaderKeys: string[];
  defaultQueryKeys: string[];
};

export function findVariableReferences(
  name: string,
  tools: VariableReferenceTool[],
  defaultHeaders: Record<string, string> | null,
  defaultQuery: Record<string, string> | null,
): VariableReferenceDetails {
  const toolNames: string[] = [];
  for (const tool of tools) {
    const templates = [
      tool.pathTemplate,
      tool.requestTemplate?.body,
      ...Object.values(tool.requestTemplate?.query ?? {}),
      ...Object.values(tool.requestTemplate?.headers ?? {}),
    ];
    if (templates.some((template) => templateReferencesName(name, template))) {
      toolNames.push(tool.name);
    }
  }
  const defaultHeaderKeys = Object.entries(defaultHeaders ?? {})
    .filter(([, value]) => templateReferencesName(name, value))
    .map(([key]) => key);
  const defaultQueryKeys = Object.entries(defaultQuery ?? {})
    .filter(([, value]) => templateReferencesName(name, value))
    .map(([key]) => key);
  return { toolNames, defaultHeaderKeys, defaultQueryKeys };
}

export function DeleteVariableDialog({
  serverId,
  name,
  tools,
  defaultHeaders,
  defaultQuery,
  onClose,
}: {
  serverId: string;
  name: string;
  tools: VariableReferenceTool[];
  defaultHeaders: Record<string, string> | null;
  defaultQuery: Record<string, string> | null;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const deleteVariable = useDeleteMcpVariable();
  const references = findVariableReferences(
    name,
    tools,
    defaultHeaders,
    defaultQuery,
  );
  const hasReferences =
    references.toolNames.length > 0 ||
    references.defaultHeaderKeys.length > 0 ||
    references.defaultQueryKeys.length > 0;

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.servers.deleteVariableTitle}</DialogTitle>
          <DialogDescription>
            {t.servers.deleteVariableDescription.replace("{name}", name)}
          </DialogDescription>
        </DialogHeader>
        {hasReferences ? (
          <ul role="alert" className="space-y-1 text-sm text-destructive">
            {references.defaultHeaderKeys.map((key) => (
              <li key={`header-${key}`}>
                {t.servers.deleteVariableReferencedDefaultHeader.replace(
                  "{key}",
                  key,
                )}
              </li>
            ))}
            {references.defaultQueryKeys.map((key) => (
              <li key={`query-${key}`}>
                {t.servers.deleteVariableReferencedDefaultQuery.replace(
                  "{key}",
                  key,
                )}
              </li>
            ))}
            {references.toolNames.length > 0 ? (
              <li>
                {t.servers.deleteVariableReferencedTools.replace(
                  "{names}",
                  references.toolNames.join(", "),
                )}
              </li>
            ) : null}
          </ul>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.servers.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteVariable.isPending}
            onClick={() =>
              deleteVariable.mutate(
                { serverId, name },
                { onSuccess: () => onClose() },
              )
            }
          >
            {deleteVariable.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {deleteVariable.isPending
              ? t.servers.deleting
              : t.servers.deleteVariable}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

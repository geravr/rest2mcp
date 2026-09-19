import { useDeleteMcpVariable } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import type { ClientCommonEntries } from "@/lib/request-definition";
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
  requestDefinition?: Record<string, unknown> | null;
};

export type VariableReferenceDetails = {
  toolNames: string[];
  commonHeaderKeys: string[];
  commonQueryKeys: string[];
};

function bindingReferencesValue(binding: unknown, valueId: string): boolean {
  return (
    !!binding &&
    typeof binding === "object" &&
    (binding as { kind?: unknown }).kind === "serverValue" &&
    (binding as { serverValueId?: unknown }).serverValueId === valueId
  );
}

/** Deep-scans a stored request definition for a `serverValue` binding by id. */
function definitionReferencesValue(node: unknown, valueId: string): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) {
    return node.some((item) => definitionReferencesValue(item, valueId));
  }
  if (bindingReferencesValue(node, valueId)) return true;
  return Object.values(node as Record<string, unknown>).some((value) =>
    definitionReferencesValue(value, valueId),
  );
}

export function findVariableReferences(
  valueId: string,
  tools: VariableReferenceTool[],
  common: ClientCommonEntries,
): VariableReferenceDetails {
  const toolNames = tools
    .filter((tool) =>
      definitionReferencesValue(tool.requestDefinition, valueId),
    )
    .map((tool) => tool.name);
  const commonHeaderKeys = common.headers
    .filter((entry) => bindingReferencesValue(entry.value, valueId))
    .map((entry) => entry.name);
  const commonQueryKeys = common.query
    .filter((entry) => bindingReferencesValue(entry.value, valueId))
    .map((entry) => entry.name);
  return { toolNames, commonHeaderKeys, commonQueryKeys };
}

export function DeleteVariableDialog({
  serverId,
  configRevision = 1,
  valueId,
  name,
  tools,
  common,
  onClose,
}: {
  serverId: string;
  configRevision?: number;
  valueId: string;
  name: string;
  tools: VariableReferenceTool[];
  common: ClientCommonEntries;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const deleteVariable = useDeleteMcpVariable();
  const references = findVariableReferences(valueId, tools, common);
  const hasReferences =
    references.toolNames.length > 0 ||
    references.commonHeaderKeys.length > 0 ||
    references.commonQueryKeys.length > 0;

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
            {references.commonHeaderKeys.map((key) => (
              <li key={`header-${key}`}>
                {t.servers.deleteVariableReferencedCommonHeader.replace(
                  "{key}",
                  key,
                )}
              </li>
            ))}
            {references.commonQueryKeys.map((key) => (
              <li key={`query-${key}`}>
                {t.servers.deleteVariableReferencedCommonQuery.replace(
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
                {
                  serverId,
                  valueId,
                  expectedRevision: configRevision,
                },
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

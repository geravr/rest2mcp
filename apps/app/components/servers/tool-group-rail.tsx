import type { McpToolGroupSummary } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui";
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";

/** `dataTransfer` type carrying `JSON.stringify({ toolIds })` from dragged rows. */
export const TOOL_IDS_DRAG_TYPE = "application/x-rest2mcp-tool-ids";

export function parseDroppedToolIds(
  event: DragEvent<HTMLDivElement>,
): string[] {
  try {
    const raw = event.dataTransfer.getData(TOOL_IDS_DRAG_TYPE);
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((id) => typeof id === "string" && id.length > 0)
    ) {
      return parsed;
    }
  } catch {
    // Unrelated or malformed drag payload; treat as no tools.
  }
  return [];
}

/**
 * Presentation-only group navigation. `value` is `undefined` for All,
 * `"ungrouped"` for Ungrouped, or a group id; the parent owns the URL value
 * and the pagination reset that accompanies a change.
 */
export function ToolGroupRail({
  groups,
  value,
  totalCount,
  atGroupLimit,
  dropDisabled,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDropTools,
}: {
  groups: McpToolGroupSummary[];
  value: string | undefined;
  /** Server-wide tool total; Ungrouped derives from it minus group counts. */
  totalCount: number;
  atGroupLimit: boolean;
  /** True while an assignment mutation is pending. */
  dropDisabled?: boolean;
  onSelect: (next: string | undefined) => void;
  onCreate: () => void;
  onRename: (group: McpToolGroupSummary) => void;
  onDelete: (group: McpToolGroupSummary) => void;
  onDropTools: (groupId: string | null, toolIds: string[]) => void;
}) {
  const { t } = useTranslations();
  const ungroupedCount = Math.max(
    totalCount - groups.reduce((sum, group) => sum + group.toolCount, 0),
    0,
  );

  return (
    <aside
      aria-label={t.servers.groups.railLabel}
      className="rounded-md border border-border p-2"
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t.servers.groups.railLabel}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label={t.servers.groups.create}
          title={t.servers.groups.create}
          disabled={atGroupLimit}
          onClick={onCreate}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <nav className="space-y-1">
        <RailEntry
          label={t.servers.groups.all}
          count={totalCount}
          active={value === undefined}
          onSelect={() => onSelect(undefined)}
        />
        <RailEntry
          label={t.servers.groups.ungrouped}
          count={ungroupedCount}
          active={value === "ungrouped"}
          onSelect={() => onSelect("ungrouped")}
          dropDisabled={dropDisabled}
          onDropTools={(toolIds) => onDropTools(null, toolIds)}
        />
        {groups.map((group) => (
          <RailEntry
            key={group.id}
            label={group.name}
            count={group.toolCount}
            active={value === group.id}
            dropDisabled={dropDisabled}
            onSelect={() => onSelect(group.id)}
            onDropTools={(toolIds) => onDropTools(group.id, toolIds)}
            trailing={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/entry:opacity-100 group-focus-within/entry:opacity-100 data-[state=open]:opacity-100"
                    aria-label={t.servers.groups.groupActions.replace(
                      "{group}",
                      group.name,
                    )}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => onRename(group)}>
                    <Pencil className="h-4 w-4" />
                    {t.servers.groups.rename}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => onDelete(group)}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t.servers.groups.delete}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        ))}
      </nav>
    </aside>
  );
}

function RailEntry({
  label,
  count,
  active,
  dropDisabled,
  onSelect,
  onDropTools,
  trailing,
}: {
  label: string;
  count: number;
  active: boolean;
  dropDisabled?: boolean;
  onSelect: () => void;
  onDropTools?: (toolIds: string[]) => void;
  trailing?: ReactNode;
}) {
  const { t } = useTranslations();
  const [dragOver, setDragOver] = useState(false);
  // The visible badge is a bare number; the accessible name keeps the unit.
  const countLabel =
    count === 1
      ? t.servers.groups.toolCountOne
      : t.servers.groups.toolCount.replace("{count}", String(count));

  return (
    <div
      className={cn(
        "group/entry relative flex items-center rounded-md transition-colors",
        dragOver
          ? "bg-accent ring-2 ring-primary"
          : active
            ? "bg-accent"
            : undefined,
      )}
      onDragOver={
        onDropTools && !dropDisabled
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={
        onDropTools && !dropDisabled ? () => setDragOver(false) : undefined
      }
      onDrop={
        onDropTools && !dropDisabled
          ? (event) => {
              event.preventDefault();
              setDragOver(false);
              const toolIds = parseDroppedToolIds(event);
              if (toolIds.length > 0) {
                onDropTools(toolIds);
              }
            }
          : undefined
      }
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
      >
        <span className="truncate">{label}</span>
        <span
          aria-hidden={true}
          className={cn(
            "ml-auto shrink-0 rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground",
            // The revealed menu takes the badge's place, so every badge stays
            // right-aligned across entries.
            trailing
              ? "transition-opacity group-hover/entry:opacity-0 group-focus-within/entry:opacity-0"
              : undefined,
          )}
        >
          {count}
        </span>
        <span className="sr-only">{countLabel}</span>
      </button>
      {trailing ? (
        <div className="absolute right-1 top-1/2 -translate-y-1/2">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

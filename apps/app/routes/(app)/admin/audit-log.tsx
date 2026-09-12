import { AdminListPagination } from "@/components/admin-list";
import { TableRowsSkeleton } from "@/components/loading";
import { useDebouncedSearchParam } from "@/hooks/use-debounced-search-param";
import { useAdminAuditLog } from "@/hooks/use-admin";
import { useTranslations } from "@/i18n/use-translations";
import {
  listPaginationSearchSchema,
  omitPaginationDefaults,
  resolvePaginationSearch,
} from "@/lib/list-search";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui";
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useCallback } from "react";
import { z } from "zod";

const auditActions = [
  "registration.enabled",
  "registration.disabled",
  "platform_invitation.created",
  "platform_invitation.revoked",
  "user.banned",
  "user.unbanned",
] as const;

const auditLogSearchSchema = listPaginationSearchSchema.extend({
  action: z.enum(auditActions).optional().catch(undefined),
});

export const Route = createFileRoute("/(app)/admin/audit-log")({
  validateSearch: auditLogSearchSchema,
  component: AdminAuditLogPage,
});

function actionLabel(
  action: string,
  t: ReturnType<typeof useTranslations>["t"],
): string {
  const labels: Record<string, string> = {
    "registration.enabled": t.admin.auditLog.registrationEnabled,
    "registration.disabled": t.admin.auditLog.registrationDisabled,
    "platform_invitation.created": t.admin.auditLog.invitationCreated,
    "platform_invitation.revoked": t.admin.auditLog.invitationRevoked,
    "user.banned": t.admin.auditLog.userSuspended,
    "user.unbanned": t.admin.auditLog.userReactivated,
  };
  return labels[action] ?? action;
}

function actionBadgeVariant(
  action: string,
): "default" | "destructive" | "secondary" {
  if (
    action.includes("banned") ||
    action.includes("disabled") ||
    action.includes("revoked")
  ) {
    return "destructive";
  }
  if (action.includes("enabled") || action.includes("unbanned")) {
    return "default";
  }
  return "secondary";
}

function AdminAuditLogPage() {
  const { t, locale } = useTranslations();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { page, pageSize, q } = resolvePaginationSearch(search);

  const replaceSearch = useCallback(
    (next: Partial<z.infer<typeof auditLogSearchSchema>>) => {
      void navigate({
        search: (prev) => omitPaginationDefaults({ ...prev, ...next }),
        replace: true,
      });
    },
    [navigate],
  );

  const [qDraft, setQDraft] = useDebouncedSearchParam(search.q, (nextQ) => {
    replaceSearch({ q: nextQ, page: undefined });
  });

  const { data, isLoading } = useAdminAuditLog({
    page,
    pageSize,
    q,
    action: search.action,
  });
  const logs = data?.items;
  const total = data?.total ?? 0;
  const hasFilters = Boolean(q || search.action);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t.admin.auditLog.title}
        </h1>
        <p className="text-muted-foreground">{t.admin.auditLog.description}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Label htmlFor="admin-audit-search" className="sr-only">
            {t.admin.auditLog.searchLabel}
          </Label>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="admin-audit-search"
            type="search"
            placeholder={t.admin.auditLog.searchPlaceholder}
            value={qDraft}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQDraft(event.target.value)
            }
            className="pl-9"
          />
        </div>
        <Select
          value={search.action ?? "all"}
          onValueChange={(value) =>
            replaceSearch({
              action:
                value === "all"
                  ? undefined
                  : (value as (typeof auditActions)[number]),
              page: undefined,
            })
          }
        >
          <SelectTrigger
            className="w-[14rem]"
            aria-label={t.admin.auditLog.actionColumn}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.admin.auditLog.allActions}</SelectItem>
            {auditActions.map((action) => (
              <SelectItem key={action} value={action}>
                {actionLabel(action, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t.admin.auditLog.recentActivity}</CardTitle>
          <CardDescription>
            {t.admin.auditLog.recentActivityDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {isLoading && !data ? (
            <TableRowsSkeleton />
          ) : logs && logs.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.admin.auditLog.actionColumn}</TableHead>
                    <TableHead>{t.admin.auditLog.userColumn}</TableHead>
                    <TableHead>{t.admin.auditLog.targetColumn}</TableHead>
                    <TableHead>{t.admin.auditLog.dateColumn}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const meta = log.metadata
                      ? safeJsonParse(log.metadata)
                      : null;
                    const metaEmail = getMetaString(meta, "email");
                    const metaReason = getMetaString(meta, "reason");

                    return (
                      <TableRow key={log.id}>
                        <TableCell>
                          <Badge variant={actionBadgeVariant(log.action)}>
                            {actionLabel(log.action, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <p>
                            {log.actorName} ({log.actorEmail})
                          </p>
                          {log.ipAddress ? (
                            <p className="text-xs">
                              {t.admin.auditLog.ipPrefix} {log.ipAddress}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {log.targetType && log.targetId ? (
                            <p>
                              {log.targetType}: {log.targetId.slice(0, 12)}…
                            </p>
                          ) : null}
                          {metaEmail ? (
                            <p className="text-xs">
                              {t.admin.auditLog.emailPrefix} {metaEmail}
                            </p>
                          ) : null}
                          {metaReason ? (
                            <p className="text-xs">
                              {t.admin.auditLog.reasonPrefix} {metaReason}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString(locale)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <AdminListPagination
                page={page}
                pageSize={pageSize}
                total={total}
                itemCount={logs.length}
                onPageChange={(nextPage) => replaceSearch({ page: nextPage })}
                onPageSizeChange={(nextSize) =>
                  replaceSearch({ pageSize: nextSize, page: undefined })
                }
              />
            </>
          ) : (
            <>
              <p className="py-6 text-center text-sm text-muted-foreground">
                {hasFilters
                  ? t.admin.auditLog.emptySearch
                  : t.admin.auditLog.noEntries}
              </p>
              <AdminListPagination
                page={page}
                pageSize={pageSize}
                total={total}
                itemCount={0}
                onPageChange={(nextPage) => replaceSearch({ page: nextPage })}
                onPageSizeChange={(nextSize) =>
                  replaceSearch({ pageSize: nextSize, page: undefined })
                }
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function safeJsonParse(str: string): Record<string, unknown> | null {
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getMetaString(
  meta: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = meta?.[key];
  return typeof value === "string" ? value : null;
}

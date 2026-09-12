import { AdminListPagination } from "@/components/admin-list";
import { TableRowsSkeleton } from "@/components/loading";
import { UserAvatar } from "@/components/user-avatar";
import { useDebouncedSearchParam } from "@/hooks/use-debounced-search-param";
import { useAdminUsers, useBanUser, useUnbanUser } from "@/hooks/use-admin";
import { useTranslations } from "@/i18n/use-translations";
import {
  listPaginationSearchSchema,
  omitPaginationDefaults,
  resolvePaginationSearch,
} from "@/lib/list-search";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
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
  Textarea,
} from "@repo/ui";
import { createFileRoute } from "@tanstack/react-router";
import {
  Ban,
  CheckCircle,
  LoaderCircle,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useState } from "react";
import { z } from "zod";

const usersSearchSchema = listPaginationSearchSchema.extend({
  status: z.enum(["active", "suspended"]).optional().catch(undefined),
  role: z.enum(["user", "super_admin"]).optional().catch(undefined),
});

export const Route = createFileRoute("/(app)/admin/users")({
  validateSearch: usersSearchSchema,
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const { t, locale } = useTranslations();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { page, pageSize, q } = resolvePaginationSearch(search);

  const replaceSearch = useCallback(
    (next: Partial<z.infer<typeof usersSearchSchema>>) => {
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

  const { data, isLoading } = useAdminUsers({
    page,
    pageSize,
    q,
    status: search.status,
    role: search.role,
  });
  const users = data?.items;
  const total = data?.total ?? 0;
  const hasFilters = Boolean(q || search.status || search.role);

  const [banTarget, setBanTarget] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [banReason, setBanReason] = useState("");

  const banMutation = useBanUser();
  const unbanMutation = useUnbanUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t.admin.users.title}
        </h1>
        <p className="text-muted-foreground">
          {t.admin.users.description.replace("{count}", String(total))}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Label htmlFor="admin-user-search" className="sr-only">
            {t.admin.users.searchLabel}
          </Label>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="admin-user-search"
            type="search"
            placeholder={t.admin.users.searchPlaceholder}
            value={qDraft}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQDraft(event.target.value)
            }
            className="pl-9"
          />
        </div>
        <Select
          value={search.status ?? "all"}
          onValueChange={(value) =>
            replaceSearch({
              status:
                value === "all" ? undefined : (value as "active" | "suspended"),
              page: undefined,
            })
          }
        >
          <SelectTrigger
            className="w-[11rem]"
            aria-label={t.admin.users.statusColumn}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.admin.users.allStatuses}</SelectItem>
            <SelectItem value="active">{t.admin.users.activeStatus}</SelectItem>
            <SelectItem value="suspended">
              {t.admin.users.suspendedStatus}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={search.role ?? "all"}
          onValueChange={(value) =>
            replaceSearch({
              role:
                value === "all" ? undefined : (value as "user" | "super_admin"),
              page: undefined,
            })
          }
        >
          <SelectTrigger
            className="w-[11rem]"
            aria-label={t.admin.users.roleColumn}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.admin.users.allRoles}</SelectItem>
            <SelectItem value="user">{t.admin.users.userRole}</SelectItem>
            <SelectItem value="super_admin">
              {t.admin.users.adminRole}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.admin.users.allUsersTitle}</CardTitle>
          <CardDescription>{t.admin.users.allUsersDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && !data ? (
            <TableRowsSkeleton />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.admin.users.nameColumn}</TableHead>
                    <TableHead>{t.admin.users.emailColumn}</TableHead>
                    <TableHead>{t.admin.users.statusColumn}</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      {t.admin.users.createdColumn}
                    </TableHead>
                    <TableHead className="text-right">
                      {t.admin.users.actionsColumn}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            id={u.id}
                            image={u.image}
                            name={u.name}
                            alt=""
                            size="sm"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{u.name}</span>
                            {u.role === "super_admin" && (
                              <Badge variant="default" className="gap-1">
                                <ShieldCheck className="h-3 w-3" />
                                {t.admin.users.adminRole}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.email}
                      </TableCell>
                      <TableCell>
                        {u.bannedAt ? (
                          <Badge variant="destructive">
                            {t.admin.users.suspendedStatus}
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            {t.admin.users.activeStatus}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {new Date(u.createdAt).toLocaleDateString(locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        {u.role !== "super_admin" &&
                          (u.bannedAt ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                unbanMutation.mutate({ userId: u.id })
                              }
                              disabled={unbanMutation.isPending}
                              className="gap-1"
                            >
                              <CheckCircle className="h-3 w-3" />
                              {t.admin.users.reactivateButton}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setBanTarget({
                                  id: u.id,
                                  name: u.name,
                                  email: u.email,
                                })
                              }
                              className="gap-1 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                            >
                              <Ban className="h-3 w-3" />
                              {t.admin.users.suspendButton}
                            </Button>
                          ))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {users?.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-6 text-center text-muted-foreground"
                      >
                        {hasFilters
                          ? t.admin.users.emptySearch
                          : t.admin.users.noUsers}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <AdminListPagination
                page={page}
                pageSize={pageSize}
                total={total}
                itemCount={users?.length ?? 0}
                onPageChange={(nextPage) => replaceSearch({ page: nextPage })}
                onPageSizeChange={(nextSize) =>
                  replaceSearch({ pageSize: nextSize, page: undefined })
                }
              />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!banTarget}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setBanTarget(null);
            setBanReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.admin.users.suspendTitle}</DialogTitle>
            <DialogDescription>
              {banTarget
                ? t.admin.users.suspendDialogDesc
                    .replace("{name}", banTarget.name)
                    .replace("{email}", banTarget.email)
                : ""}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <Label htmlFor="suspend-reason">
              {t.admin.users.suspendReasonLabel}
            </Label>
            <Textarea
              id="suspend-reason"
              placeholder={t.admin.users.suspendReasonPlaceholder}
              value={banReason}
              onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                setBanReason(event.target.value)
              }
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBanTarget(null);
                setBanReason("");
              }}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={banMutation.isPending}
              onClick={() => {
                banMutation.mutate(
                  {
                    userId: banTarget?.id || "",
                    reason: banReason || undefined,
                  },
                  {
                    onSuccess: () => {
                      setBanTarget(null);
                      setBanReason("");
                    },
                  },
                );
              }}
            >
              {banMutation.isPending && (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t.admin.users.confirmSuspend}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

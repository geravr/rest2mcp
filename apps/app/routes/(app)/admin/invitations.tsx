import { AdminListPagination } from "@/components/admin-list";
import { TableRowsSkeleton } from "@/components/loading";
import { useDebouncedSearchParam } from "@/hooks/use-debounced-search-param";
import {
  useAdminInvitations,
  useCreateInvitation,
  useRevokeInvitation,
} from "@/hooks/use-admin";
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
} from "@repo/ui";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, Mail, Plus, Search, XCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { z } from "zod";

const invitationStatuses = [
  "pending",
  "accepted",
  "expired",
  "revoked",
] as const;

const invitationsSearchSchema = listPaginationSearchSchema.extend({
  status: z.enum(invitationStatuses).optional().catch(undefined),
});

export const Route = createFileRoute("/(app)/admin/invitations")({
  validateSearch: invitationsSearchSchema,
  component: AdminInvitationsPage,
});

function statusBadge(
  status: string,
  t: ReturnType<typeof useTranslations>["t"],
) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline">{t.admin.invitations.statusPending}</Badge>
      );
    case "accepted":
      return <Badge>{t.admin.invitations.statusAccepted}</Badge>;
    case "expired":
      return (
        <Badge variant="secondary">{t.admin.invitations.statusExpired}</Badge>
      );
    case "revoked":
      return (
        <Badge variant="destructive">{t.admin.invitations.statusRevoked}</Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function AdminInvitationsPage() {
  const { t, locale } = useTranslations();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { page, pageSize, q } = resolvePaginationSearch(search);

  const replaceSearch = useCallback(
    (next: Partial<z.infer<typeof invitationsSearchSchema>>) => {
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

  const { data, isLoading } = useAdminInvitations({
    page,
    pageSize,
    q,
    status: search.status,
  });
  const invitations = data?.items;
  const total = data?.total ?? 0;
  const hasFilters = Boolean(q || search.status);
  const createMutation = useCreateInvitation();
  const revokeMutation = useRevokeInvitation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");

  const handleCreate = () => {
    if (!email.trim()) return;
    createMutation.mutate(
      { email: email.trim() },
      {
        onSuccess: () => {
          setEmail("");
          setDialogOpen(false);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t.admin.invitations.pageTitle}
          </h1>
          <p className="text-muted-foreground">
            {t.admin.invitations.pageDescription}
          </p>
        </div>

        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t.admin.invitations.newInvitation}
        </Button>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setEmail("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.admin.invitations.dialogTitle}</DialogTitle>
              <DialogDescription>
                {t.admin.invitations.dialogDescription}
              </DialogDescription>
            </DialogHeader>
            <Field>
              <Label htmlFor="invitation-email">
                {t.admin.invitations.emailLabel}
              </Label>
              <Input
                id="invitation-email"
                type="email"
                placeholder={t.admin.invitations.emailPlaceholder}
                value={email}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setEmail(event.target.value)
                }
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter") handleCreate();
                }}
              />
            </Field>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setEmail("");
                  setDialogOpen(false);
                }}
              >
                {t.common.cancel}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!email.trim() || createMutation.isPending}
              >
                <Mail className="mr-2 h-4 w-4" />
                {t.admin.invitations.sendButton}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Label htmlFor="admin-invitation-search" className="sr-only">
            {t.admin.invitations.searchLabel}
          </Label>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="admin-invitation-search"
            type="search"
            placeholder={t.admin.invitations.searchPlaceholder}
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
                value === "all"
                  ? undefined
                  : (value as (typeof invitationStatuses)[number]),
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
            <SelectItem value="all">
              {t.admin.invitations.allStatuses}
            </SelectItem>
            <SelectItem value="pending">
              {t.admin.invitations.statusPending}
            </SelectItem>
            <SelectItem value="accepted">
              {t.admin.invitations.statusAccepted}
            </SelectItem>
            <SelectItem value="expired">
              {t.admin.invitations.statusExpired}
            </SelectItem>
            <SelectItem value="revoked">
              {t.admin.invitations.statusRevoked}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.admin.invitations.title}</CardTitle>
          <CardDescription>
            {t.admin.invitations.listDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && !data ? (
            <TableRowsSkeleton rows={3} />
          ) : invitations && invitations.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.admin.invitations.emailLabel}</TableHead>
                    <TableHead>{t.admin.users.statusColumn}</TableHead>
                    <TableHead>{t.admin.invitations.createdOn}</TableHead>
                    <TableHead className="text-right">
                      {t.admin.users.actionsColumn}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{inv.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(inv.status, t)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(inv.createdAt).toLocaleDateString(locale)}
                        </span>
                        {inv.status === "pending" && (
                          <p className="mt-1 text-xs">
                            {t.admin.invitations.expiresOn}:{" "}
                            {new Date(inv.expiresAt).toLocaleDateString(locale)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {inv.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              revokeMutation.mutate({ invitationId: inv.id })
                            }
                            disabled={revokeMutation.isPending}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <XCircle className="h-4 w-4" />
                            {t.admin.invitations.revokeButton}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <AdminListPagination
                page={page}
                pageSize={pageSize}
                total={total}
                itemCount={invitations.length}
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
                  ? t.admin.invitations.emptySearch
                  : t.admin.invitations.noInvitations}
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

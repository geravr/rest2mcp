import { api } from "@/lib/trpc";
import { useQuery } from "@tanstack/react-query";

export function useUserMeQuery() {
  return useQuery(api.user.me.queryOptions());
}

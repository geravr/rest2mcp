import { useEffect, useState } from "react";
import { useDebouncedValue } from "./use-debounced-value";

export function useDebouncedSearchParam(
  committedQ: string | undefined,
  onCommit: (q: string | undefined) => void,
) {
  const [draft, setDraft] = useState(committedQ ?? "");
  const [prevCommitted, setPrevCommitted] = useState(committedQ);

  if (committedQ !== prevCommitted) {
    setPrevCommitted(committedQ);
    setDraft(committedQ ?? "");
  }

  const debounced = useDebouncedValue(draft, 300);

  useEffect(() => {
    if (draft !== debounced) return;
    const next = debounced.trim() || undefined;
    const current = committedQ?.trim() || undefined;
    if (next !== current) {
      onCommit(next);
    }
  }, [committedQ, debounced, draft, onCommit]);

  return [draft, setDraft] as const;
}

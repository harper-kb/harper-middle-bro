import type { ReactNode } from "react";
import { RecordsFilterProvider } from "@/app/all-accounts/RecordsFilterProvider";
import {
  normalizeRecordsFilterState,
  parseRecordsFilterState,
  type RecordsFilterPatch,
  type RecordsView,
} from "@/app/all-accounts/records-filter-state";

export function recordsTestState(
  view: RecordsView = "pending",
  params: Record<string, string | undefined> = {},
  patch: RecordsFilterPatch = {},
) {
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as RecordsFilterPatch;
  return normalizeRecordsFilterState({
    ...parseRecordsFilterState(view, params),
    ...definedPatch,
  });
}

export function RecordsTestProvider({
  view = "pending",
  params = {},
  patch = {},
  children,
}: {
  view?: RecordsView;
  params?: Record<string, string | undefined>;
  patch?: RecordsFilterPatch;
  children: ReactNode;
}) {
  return (
    <RecordsFilterProvider state={recordsTestState(view, params, patch)}>
      {children}
    </RecordsFilterProvider>
  );
}

export type NoteThreadType = "producer" | "service";

export type NoteThreadEntry = {
  id: string;
  body: string;
  author: string;
  createdAt: string | null;
  updatedAt: string | null;
  edited: boolean;
  orderId: number;
  orderLabel: string;
};

export type NoteThread = {
  type: NoteThreadType;
  /** Producer Notes are order-scoped; Service Notes are account-scoped. */
  scope: "order" | "account";
  entries: NoteThreadEntry[];
  version: string;
  latestAt: string | null;
};

export type NoteThreadsResponse = {
  accountId: number;
  orderId: number;
  producer: NoteThread;
  service: NoteThread;
};

export type NoteSummaryResponse = {
  status: "ready" | "unavailable";
  summary: string | null;
  generatedAt: string | null;
  threadVersion: string;
  cacheHit: boolean;
  method?: "ai";
  /** Deterministic names from authorized visible entries, never AI-inferred. */
  participants?: string[];
  error?: string;
};

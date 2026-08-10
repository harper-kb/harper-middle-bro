import type { WorkItem, WorkItemPriorityReason } from "@/lib/types";

export type PersonalStrip = {
  assigned: WorkItem[];
  parked: WorkItem[];
  followUps: WorkItem[];
  handoffs: WorkItem[];
  doneToday: {
    id: string;
    title: string;
    accountName: string;
    completedAt: string;
  }[];
};

export type DeskBundle = {
  queue: WorkItem[];
  next: WorkItem | null;
  whyNext: WorkItemPriorityReason[];
  strip: PersonalStrip;
  mode: "sample" | "live";
  modeReason: string;
};

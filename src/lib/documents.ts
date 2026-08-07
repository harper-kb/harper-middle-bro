import {
  conventionName,
  guessKind,
  type DocConventionKind,
} from "./filenames";

export type DocumentFolder =
  | "service_request"
  | "policy"
  | "endorsement"
  | "correspondence";

export type DocumentKind =
  | "quote"
  | "policy"
  | "customer_upload"
  | "endorsement"
  | "contract"
  | "coi"
  | "other";

export interface DeskDocument {
  id: string;
  accountId: string;
  policyId: string | null;
  ticketId: string | null;
  carrierId: string | null;
  folder: DocumentFolder;
  kind: DocumentKind;
  originalName: string;
  canonicalName: string;
  storagePath: string | null;
  trusted: boolean;
  sizeBytes: number | null;
  sizeLabel: string | null;
  createdAt: string;
}

export function folderForKind(kind: DocumentKind | DocConventionKind): DocumentFolder {
  switch (kind) {
    case "policy":
    case "quote":
      return "policy";
    case "endorsement":
      return "endorsement";
    case "contract":
    case "coi":
    case "customer_upload":
      return "service_request";
    default:
      return "correspondence";
  }
}

export function documentKindFromConvention(
  kind: DocConventionKind,
): DocumentKind {
  switch (kind) {
    case "coi":
      return "coi";
    case "quote":
      return "quote";
    case "policy":
      return "policy";
    case "endorsement":
      return "endorsement";
    case "contract":
      return "contract";
    default:
      return "other";
  }
}

export function sizeLabelFromBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Rename on ingest: entity + kind, never leave scan_001.pdf in the file. */
export function renameIncomingDoc(input: {
  entity: string;
  originalName: string;
  kind?: DocConventionKind;
  taken?: string[];
}): { kind: DocConventionKind; canonicalName: string; folder: DocumentFolder } {
  const kind = input.kind ?? guessKind(input.originalName);
  const canonicalName = conventionName({
    entity: input.entity,
    kind,
    originalName: input.originalName,
    taken: input.taken,
  });
  return {
    kind,
    canonicalName,
    folder: folderForKind(kind),
  };
}

export function folderLabel(folder: DocumentFolder): string {
  switch (folder) {
    case "service_request":
      return "Service Request";
    case "policy":
      return "Policy Documents";
    case "endorsement":
      return "Endorsements";
    case "correspondence":
      return "Correspondence";
  }
}

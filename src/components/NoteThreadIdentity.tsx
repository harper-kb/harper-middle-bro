import type { NoteThreadType } from "@/lib/note-thread-types";

/**
 * One semantic identity contract for every Producer/Service Note surface.
 * Color roles live in globals.css; components consume only these stable
 * identity classes so collapsed previews, expanded cards and drawers cannot
 * drift into different status colors.
 */
export const NOTE_THREAD_PRESENTATION = {
  producer: {
    label: "Producer Notes",
    previewLabel: "Producer Note",
    scopeLabel: "This order",
    addLabel: "Add producer note",
    identityClass: "note-identity--producer",
  },
  service: {
    label: "Service Notes",
    previewLabel: "Service Note",
    scopeLabel: "Entire account",
    addLabel: "Add service note",
    identityClass: "note-identity--service",
  },
} as const satisfies Record<
  NoteThreadType,
  {
    label: string;
    previewLabel: string;
    scopeLabel: string;
    addLabel: string;
    identityClass: string;
  }
>;

/**
 * Shared icon family: Producer is a document, Service is a conversation.
 * Visible text always names the thread, so these marks remain decorative.
 */
export function NoteThreadIcon({
  type,
  className,
}: {
  type: NoteThreadType;
  className?: string;
}) {
  if (type === "producer") {
    return (
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className={className}
      >
        <path
          d="M4 2.75h8.1L16 6.65v10.6H4V2.75Zm8 0v4h4M7 10h6M7 13h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <path
        d="M3 4.25h14v9.5H8l-4 3v-3H3v-9.5ZM6.5 8h7M6.5 10.75h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import Link from "next/link";
import type {
  SpineIssueCard,
  SpineTaskLinkRow,
} from "@/lib/service-spine/domain";

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M3.5 8h8.5M9 4.75 12.25 8 9 11.25" />
    </svg>
  );
}

function ConnectionRow({
  label,
  value,
  meta,
  href,
}: {
  label: string;
  value: string;
  meta?: string;
  href?: string;
}) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted)]">
          {label}
        </p>
        <p className="mt-1 break-all text-sm font-semibold text-[var(--ink)]">
          {value}
        </p>
        {meta ? (
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">{meta}</p>
        ) : null}
      </div>
      {href ? <ArrowIcon /> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="flex min-h-16 items-center gap-3 rounded-xl border border-[var(--rule)] bg-[var(--surface)] px-4 py-3 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {content}
      </Link>
    );
  }
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-xl border border-[var(--rule)] bg-[var(--surface)] px-4 py-3">
      {content}
    </div>
  );
}

export function IssueConnections({
  issue,
  links,
}: {
  issue: SpineIssueCard;
  links: SpineTaskLinkRow[];
}) {
  const hasCompany = Boolean(issue.accountId);
  if (!hasCompany && links.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--rule)] px-4 py-5 text-sm text-[var(--muted)]">
        No verified connections are available for this issue.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {issue.accountId ? (
        <ConnectionRow
          label="Company account"
          value={issue.companyName ?? issue.accountId}
          meta={issue.accountId}
          href={`/accounts/${issue.accountId}`}
        />
      ) : null}
      {links.map((link) => (
        <ConnectionRow
          key={link.id}
          label={link.linkKind.replace(/_/g, " ")}
          value={link.linkRef ?? "Reference unavailable"}
          meta={`From ${link.taskTitle ?? `task #${link.taskId}`}`}
        />
      ))}
    </div>
  );
}

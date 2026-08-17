import { useId, type ReactNode } from "react";

export type CompanyCardTone =
  | "producer"
  | "time"
  | "location"
  | "contacts"
  | "premium"
  | "revenue"
  | "payment";

export type CompanyCardIconName =
  | CompanyCardTone
  | "company-id";

function CardSvg({ name }: { name: CompanyCardIconName }) {
  if (name === "producer") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.35" />
        <path d="M4.5 16c.7-3 2.55-4.5 5.5-4.5S14.8 13 15.5 16" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "time") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.35" />
        <path d="M10 6.25v4l2.75 1.65" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "location") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M15.5 8.25c0 4.15-5.5 8.25-5.5 8.25S4.5 12.4 4.5 8.25a5.5 5.5 0 1 1 11 0Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
        <circle cx="10" cy="8.25" r="1.75" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    );
  }
  if (name === "contacts") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="7.25" cy="7.25" r="2.5" stroke="currentColor" strokeWidth="1.25" />
        <circle cx="13.5" cy="8" r="2" stroke="currentColor" strokeWidth="1.25" />
        <path d="M2.75 15.5c.55-2.55 2.05-3.8 4.5-3.8s3.95 1.25 4.5 3.8M11.25 12.2c.65-.5 1.4-.75 2.25-.75 2 0 3.25 1.05 3.75 3.15" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "premium" || name === "revenue") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3" y="4.25" width="14" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.35" />
        <path d="M3.5 8h13M6 12h3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        {name === "revenue" ? (
          <path d="m12.25 12.75 1.5-1.5 1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
      </svg>
    );
  }
  if (name === "payment") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3.25 6.25h13.5v9H3.25v-9Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
        <path d="M5.25 4.25h9.5M6.25 10.75h3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <circle cx="13.75" cy="10.75" r="1.5" stroke="currentColor" strokeWidth="1.25" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 16.25V6.5L10 3l6 3.5v9.75M7 16.25v-2.5h6v2.5M7 7.25h1.5M11.5 7.25H13M7 10.25h1.5M11.5 10.25H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CompanyCardIcon({
  name,
  className = "",
}: {
  name: CompanyCardIconName;
  className?: string;
}) {
  return (
    <span className={`company-card-icon ${className}`} aria-hidden="true">
      <span className="h-[18px] w-[18px]">
        <CardSvg name={name} />
      </span>
    </span>
  );
}

export function CompanySummaryCard({
  tone,
  label,
  icon = tone,
  help,
  action,
  className = "",
  children,
}: {
  tone: CompanyCardTone;
  label: string;
  icon?: CompanyCardIconName;
  help?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      className={`company-summary-card company-summary-card--${tone} ${className}`}
      aria-labelledby={headingId}
      data-company-card={tone}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <CompanyCardIcon name={icon} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h2 id={headingId} className="company-card-label">
            {label}
          </h2>
          {help ? (
            <span
              tabIndex={0}
              role="note"
              aria-label={help}
              title={help}
              className="company-card-help"
            >
              i
            </span>
          ) : null}
        </div>
        {action}
      </div>
      <div className="company-card-content">{children}</div>
    </section>
  );
}

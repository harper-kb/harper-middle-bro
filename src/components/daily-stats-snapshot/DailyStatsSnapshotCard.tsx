import {
  dailyStatsSnapshotAltText,
  formatCapturedMetadata,
  formatSnapshotDate,
  formatSnapshotTime,
  type DailyStatsSnapshot,
} from "@/lib/daily-stats-snapshot";

export const DAILY_STATS_SNAPSHOT_WIDTH = 1600;
export const DAILY_STATS_SNAPSHOT_HEIGHT = 900;
export const DAILY_STATS_SNAPSHOT_FONT_FAMILY =
  "Arial, Helvetica, sans-serif";

type MetricKind = "bind" | "orders" | "bound" | "coi";

type MetricCard = {
  kind: MetricKind;
  label: string;
  value: number;
  accent: string;
  tint: string;
};

function metricFontSize(value: number): number {
  const length = value.toLocaleString("en-US").length;
  if (length <= 3) return 94;
  if (length <= 5) return 82;
  if (length <= 7) return 68;
  return 56;
}

function MetricGlyph({
  kind,
  x,
  y,
  accent,
}: {
  kind: MetricKind;
  x: number;
  y: number;
  accent: string;
}) {
  const common = {
    fill: "none",
    stroke: accent,
    strokeWidth: 3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      {kind === "bind" ? (
        <>
          <path d="M8 24h26" {...common} />
          <path d="m26 14 10 10-10 10" {...common} />
        </>
      ) : null}
      {kind === "orders" ? (
        <>
          <rect x="10" y="7" width="25" height="32" rx="4" {...common} />
          <path d="M17 17h11M22.5 25v10M17.5 30h10" {...common} />
        </>
      ) : null}
      {kind === "bound" ? (
        <>
          <path d="M22.5 5 37 11v11c0 9-5.6 15-14.5 19C13.6 37 8 31 8 22V11l14.5-6Z" {...common} />
          <path d="m15.5 23 5 5 10-11" {...common} />
        </>
      ) : null}
      {kind === "coi" ? (
        <>
          <rect x="6" y="10" width="34" height="27" rx="5" {...common} />
          <path d="m8.5 14 14.5 11L37.5 14" {...common} />
        </>
      ) : null}
    </g>
  );
}

function MetricCardGraphic({
  card,
  index,
  snapshot,
}: {
  card: MetricCard;
  index: number;
  snapshot: DailyStatsSnapshot;
}) {
  const x = 96 + index * 358;
  const y = 378;
  const width = 334;
  const height = 284;
  const value = card.value.toLocaleString("en-US");

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="28"
        fill="#11222f"
        stroke={card.accent}
        strokeOpacity="0.34"
        strokeWidth="2"
      />
      <rect
        x={x + 20}
        y={y + 1}
        width={width - 40}
        height="5"
        rx="2.5"
        fill={card.accent}
        opacity="0.92"
      />
      <rect
        x={x + 28}
        y={y + 28}
        width="58"
        height="58"
        rx="17"
        fill={card.tint}
        stroke={card.accent}
        strokeOpacity="0.34"
      />
      <MetricGlyph
        kind={card.kind}
        x={x + 35}
        y={y + 34}
        accent={card.accent}
      />
      <text
        x={x + 104}
        y={y + 65}
        fill="#aebdca"
        fontSize="22"
        fontWeight="700"
        letterSpacing="2.7"
      >
        {card.label}
      </text>
      <text
        x={x + width / 2}
        y={y + 190}
        fill="#f7fafc"
        fontSize={metricFontSize(card.value)}
        fontWeight="700"
        letterSpacing="-3"
        textAnchor="middle"
      >
        {value}
      </text>

      {card.kind === "bind" ? (
        <>
          <line
            x1={x + width / 2}
            y1={y + 222}
            x2={x + width / 2}
            y2={y + 260}
            stroke="#314553"
            strokeWidth="2"
          />
          <text
            x={x + width * 0.25}
            y={y + 246}
            textAnchor="middle"
          >
            <tspan fill="#f7fafc" fontSize="23" fontWeight="700">
              {snapshot.metrics.bindSent.sameDay.toLocaleString("en-US")}
            </tspan>
            <tspan
              dx="9"
              fill="#91a2af"
              fontSize="17"
              fontWeight="600"
            >
              same-day
            </tspan>
          </text>
          <text
            x={x + width * 0.75}
            y={y + 246}
            textAnchor="middle"
          >
            <tspan fill="#f7fafc" fontSize="23" fontWeight="700">
              {snapshot.metrics.bindSent.backlog.toLocaleString("en-US")}
            </tspan>
            <tspan
              dx="9"
              fill="#91a2af"
              fontSize="17"
              fontWeight="600"
            >
              backlog
            </tspan>
          </text>
        </>
      ) : (
        <rect
          x={x + width / 2 - 23}
          y={y + 241}
          width="46"
          height="4"
          rx="2"
          fill={card.accent}
          opacity="0.58"
        />
      )}
    </g>
  );
}

export function DailyStatsSnapshotCard({
  snapshot,
  harperLogoSrc,
  stepBroLogoSrc,
  fontFamily = DAILY_STATS_SNAPSHOT_FONT_FAMILY,
}: {
  snapshot: DailyStatsSnapshot;
  harperLogoSrc: string;
  stepBroLogoSrc: string;
  fontFamily?: string;
}) {
  const cards: MetricCard[] = [
    {
      kind: "bind",
      label: "BIND SENT",
      value: snapshot.metrics.bindSent.total,
      accent: "#ff7067",
      tint: "#321f24",
    },
    {
      kind: "orders",
      label: "NEW ORDERS",
      value: snapshot.metrics.newOrders,
      accent: "#45c8c3",
      tint: "#153235",
    },
    {
      kind: "bound",
      label: "BOUND",
      value: snapshot.metrics.bound,
      accent: "#66a9ff",
      tint: "#172d45",
    },
    {
      kind: "coi",
      label: "COIs SENT",
      value: snapshot.metrics.coisSent,
      accent: "#70d49a",
      tint: "#183529",
    },
  ];
  const captured = formatCapturedMetadata(snapshot);
  const dataUpdated = snapshot.dataUpdatedAt
    ? `${formatSnapshotDate(snapshot.dataUpdatedAt, snapshot.capturedTimeZone)} · ${formatSnapshotTime(snapshot.dataUpdatedAt, snapshot.capturedTimeZone)}`
    : null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={DAILY_STATS_SNAPSHOT_WIDTH}
      height={DAILY_STATS_SNAPSHOT_HEIGHT}
      viewBox={`0 0 ${DAILY_STATS_SNAPSHOT_WIDTH} ${DAILY_STATS_SNAPSHOT_HEIGHT}`}
      role="img"
      aria-label={dailyStatsSnapshotAltText(snapshot)}
      style={{ fontFamily, fontVariantNumeric: "tabular-nums" }}
    >
      <title>Step Bro daily operations snapshot</title>
      <desc>{dailyStatsSnapshotAltText(snapshot)}</desc>
      <defs>
        <linearGradient id="snapshot-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0b1822" />
          <stop offset="0.58" stopColor="#0a151e" />
          <stop offset="1" stopColor="#101b27" />
        </linearGradient>
        <radialGradient id="snapshot-coral" cx="0" cy="0" r="1">
          <stop offset="0" stopColor="#ff7067" stopOpacity="0.17" />
          <stop offset="1" stopColor="#ff7067" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="snapshot-teal" cx="0" cy="0" r="1">
          <stop offset="0" stopColor="#45c8c3" stopOpacity="0.11" />
          <stop offset="1" stopColor="#45c8c3" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect
        width={DAILY_STATS_SNAPSHOT_WIDTH}
        height={DAILY_STATS_SNAPSHOT_HEIGHT}
        fill="url(#snapshot-bg)"
      />
      <circle cx="120" cy="70" r="480" fill="url(#snapshot-coral)" />
      <circle cx="1500" cy="850" r="560" fill="url(#snapshot-teal)" />
      <rect
        x="24"
        y="24"
        width="1552"
        height="852"
        rx="44"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.08"
        strokeWidth="2"
      />

      <image
        href={harperLogoSrc}
        x="96"
        y="76"
        width="188"
        height="48"
        preserveAspectRatio="xMinYMid meet"
      />
      <image
        href={stepBroLogoSrc}
        x="310"
        y="70"
        width="176"
        height="54"
        preserveAspectRatio="xMinYMid meet"
      />

      <rect
        x="1284"
        y="76"
        width="220"
        height="48"
        rx="24"
        fill="#ffffff"
        fillOpacity="0.055"
        stroke="#ffffff"
        strokeOpacity="0.12"
      />
      <text
        x="1394"
        y="100"
        fontWeight="700"
        dominantBaseline="middle"
        textAnchor="middle"
      >
        <tspan fill="#ff7067" fontSize="17" letterSpacing="0">
          ●
        </tspan>
        <tspan
          dx="12"
          fill="#c5d0d9"
          fontSize="17"
          letterSpacing="2.3"
        >
          DAILY SNAPSHOT
        </tspan>
      </text>

      <text
        x="96"
        y="232"
        fill="#8fa0ad"
        fontSize="22"
        fontWeight="700"
        letterSpacing="4.2"
      >
        DAILY OPERATIONS
      </text>
      <text
        x="96"
        y="320"
        fill="#f8fafc"
        fontSize="63"
        fontWeight="650"
        letterSpacing="-1.8"
      >
        {snapshot.selectedDateLabel}
      </text>

      {cards.map((card, index) => (
        <MetricCardGraphic
          key={card.kind}
          card={card}
          index={index}
          snapshot={snapshot}
        />
      ))}

      <line
        x1="96"
        y1="718"
        x2="1504"
        y2="718"
        stroke="#ffffff"
        strokeOpacity="0.1"
        strokeWidth="2"
      />
      <circle cx="108" cy="773" r="7" fill="#ff7067" />
      <text
        x="132"
        y="782"
        fill="#e8eef2"
        fontSize="27"
        fontWeight="600"
      >
        Snapshot taken {captured}
      </text>
      {dataUpdated ? (
        <text
          x="132"
          y="827"
          fill="#8395a3"
          fontSize="21"
          fontWeight="500"
        >
          Data updated {dataUpdated}
        </text>
      ) : null}
      <text
        x="1504"
        y="827"
        fill="#aebdca"
        fontSize="18"
        fontWeight="700"
        letterSpacing="2.2"
        textAnchor="end"
      >
        BUILT FOR SERVICE
      </text>
    </svg>
  );
}

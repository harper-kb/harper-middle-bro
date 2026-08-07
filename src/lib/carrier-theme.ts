/**
 * Visual identity for carrier cards — thematic backdrop + logo domain.
 * Logos load from a public favicon/logo CDN; monogram tiles are the fallback.
 */

export interface CarrierTheme {
  /** Carrier's web domain, for reference */
  domain: string;
  /**
   * Vendored brand asset under /public/logos — downloaded from the
   * carrier's own site (or Wikimedia Commons) and visually verified.
   * Absent means no clean official asset was obtainable; the designed
   * monogram renders instead. Never hotlink favicons.
   */
  logo?: string;
  /** 1–2 letter mark */
  initials: string;
  /** Soft card wash */
  bg: string;
  /** Stronger header wash */
  header: string;
  /** Accent for chips / borders */
  accent: string;
  /** Text on monogram tile */
  ink: string;
  /** Monogram tile fill */
  mark: string;
}

const THEMES: Record<string, CarrierTheme> = {
  Hiscox: {
    domain: "hiscox.com",
    logo: "/logos/hiscox.svg",
    initials: "HX",
    bg: "linear-gradient(145deg, #e8f4f1 0%, #f7faf9 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #0b3d3a 0%, #1a6b63 100%)",
    accent: "#1a6b63",
    ink: "#e8f4f1",
    mark: "#0b3d3a",
  },
  Coterie: {
    domain: "coterieinsurance.com",
    logo: "/logos/coterie.png",
    initials: "CO",
    bg: "linear-gradient(145deg, #f3eefc 0%, #faf8ff 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #4c1d95 0%, #7c3aed 100%)",
    accent: "#7c3aed",
    ink: "#f5f3ff",
    mark: "#5b21b6",
  },
  AmTrust: {
    domain: "amtrustfinancial.com",
    logo: "/logos/amtrust.png",
    initials: "AT",
    bg: "linear-gradient(145deg, #e8f0fb 0%, #f7f9fc 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #1e3a8a 0%, #2563eb 100%)",
    accent: "#2563eb",
    ink: "#eff6ff",
    mark: "#1e40af",
  },
  "NEXT Insurance": {
    domain: "nextinsurance.com",
    logo: "/logos/next.svg",
    initials: "NX",
    bg: "linear-gradient(145deg, #e6f9ef 0%, #f5fcf8 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #065f46 0%, #10b981 100%)",
    accent: "#059669",
    ink: "#ecfdf5",
    mark: "#047857",
  },
  Markel: {
    domain: "markel.com",
    logo: "/logos/markel.svg",
    initials: "MK",
    bg: "linear-gradient(145deg, #eef2f6 0%, #f7f8fa 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #1e293b 0%, #475569 100%)",
    accent: "#b45309",
    ink: "#f8fafc",
    mark: "#0f172a",
  },
  Kinsale: {
    domain: "kinsaleins.com",
    logo: "/logos/kinsale.svg",
    initials: "KI",
    bg: "linear-gradient(145deg, #f6ecec 0%, #fbf7f7 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #7f1d1d 0%, #b91c1c 100%)",
    accent: "#b91c1c",
    ink: "#fef2f2",
    mark: "#991b1b",
  },
  Thimble: {
    domain: "thimble.com",
    initials: "TH",
    bg: "linear-gradient(145deg, #eef6fb 0%, #f7fbfd 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #0e7490 0%, #22d3ee 100%)",
    accent: "#0891b2",
    ink: "#ecfeff",
    mark: "#0e7490",
  },
  USLI: {
    domain: "usli.com",
    logo: "/logos/usli.png",
    initials: "US",
    bg: "linear-gradient(145deg, #eaf0f8 0%, #f6f8fb 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #1e3a5f 0%, #3b82f6 100%)",
    accent: "#1d4ed8",
    ink: "#eff6ff",
    mark: "#1e3a5f",
  },
  ISC: {
    // Matches the verified underwriter emails (@iscmga.com); site sits
    // behind Cloudflare so no clean logo asset yet — monogram renders.
    domain: "iscmga.com",
    initials: "IS",
    bg: "linear-gradient(145deg, #fff4e8 0%, #fffaf5 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #9a3412 0%, #ea580c 100%)",
    accent: "#ea580c",
    ink: "#fff7ed",
    mark: "#c2410c",
  },
  "RT Specialty": {
    domain: "rtspecialty.com",
    logo: "/logos/rt.svg",
    initials: "RT",
    bg: "linear-gradient(145deg, #e8eef6 0%, #f5f7fb 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #0f2744 0%, #1e4a7a 100%)",
    accent: "#1e4a7a",
    ink: "#e8eef6",
    mark: "#0f2744",
  },
  AMWins: {
    domain: "amwins.com",
    initials: "AW",
    bg: "linear-gradient(145deg, #e9f2ec 0%, #f5faf7 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #14532d 0%, #16a34a 100%)",
    accent: "#15803d",
    ink: "#f0fdf4",
    mark: "#166534",
  },
  "Byberg / ByWork": {
    domain: "bywork.com",
    initials: "BY",
    bg: "linear-gradient(145deg, #f0f4f8 0%, #f8fafc 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #334155 0%, #64748b 100%)",
    accent: "#475569",
    ink: "#f8fafc",
    mark: "#334155",
  },
  RPS: {
    domain: "rpsins.com",
    initials: "RP",
    bg: "linear-gradient(145deg, #f3eef6 0%, #faf7fb 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #581c87 0%, #a855f7 100%)",
    accent: "#9333ea",
    ink: "#faf5ff",
    mark: "#6b21a8",
  },
  Progressive: {
    domain: "progressive.com",
    logo: "/logos/progressive.svg",
    initials: "PG",
    bg: "linear-gradient(145deg, #e8f5ec 0%, #f5fbf7 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #166534 0%, #22c55e 100%)",
    accent: "#16a34a",
    ink: "#f0fdf4",
    mark: "#15803d",
  },
  Geico: {
    domain: "geico.com",
    logo: "/logos/geico.svg",
    initials: "GE",
    bg: "linear-gradient(145deg, #e8f0e8 0%, #f5f8f5 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #14532d 0%, #4ade80 55%, #fbbf24 100%)",
    accent: "#ca8a04",
    ink: "#14532d",
    mark: "#facc15",
  },
  "First Insurance": {
    domain: "firstinsurancefunding.com",
    initials: "FI",
    bg: "linear-gradient(145deg, #eef2f7 0%, #f7f9fb 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #1e293b 0%, #64748b 100%)",
    accent: "#475569",
    ink: "#f8fafc",
    mark: "#1e293b",
  },
  Symbol: {
    domain: "symbolinsurance.com",
    initials: "SY",
    bg: "linear-gradient(145deg, #eceef8 0%, #f6f7fb 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #312e81 0%, #6366f1 100%)",
    accent: "#4f46e5",
    ink: "#eef2ff",
    mark: "#3730a3",
  },
  TMR: {
    domain: "tmrinsurance.com",
    initials: "TM",
    bg: "linear-gradient(145deg, #f1efe9 0%, #f9f8f5 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #44403c 0%, #a8a29e 100%)",
    accent: "#78716c",
    ink: "#fafaf9",
    mark: "#44403c",
  },
  Endurance: {
    domain: "sompo.com",
    initials: "EN",
    bg: "linear-gradient(145deg, #e8eef5 0%, #f5f8fb 55%, #ffffff 100%)",
    header: "linear-gradient(120deg, #0c4a6e 0%, #0284c7 100%)",
    accent: "#0369a1",
    ink: "#e0f2fe",
    mark: "#0c4a6e",
  },
};

const FALLBACK: CarrierTheme = {
  domain: "example.com",
  initials: "??",
  bg: "linear-gradient(145deg, #f0f2f4 0%, #fafafa 55%, #ffffff 100%)",
  header: "linear-gradient(120deg, #1a2c36 0%, #4a5c66 100%)",
  accent: "#1a2c36",
  ink: "#f4f3f0",
  mark: "#1a2c36",
};

export function getCarrierTheme(name: string): CarrierTheme {
  return THEMES[name] ?? {
    ...FALLBACK,
    initials: name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join(""),
  };
}

/*
 * No favicon scraping: every free logo endpoint serves 32–128px icons that
 * upscale into mush. Until licensed brand assets are on disk, the mark is
 * a designed monogram tile (CarrierLogo) — crisp at any size, on-theme,
 * and never a blurry copy-paste.
 */

import {
  AlertPayload,
  University,
  AlertConfig,
  ColumbiaAlertConfig,
  ColumbiaCampus,
  Coordinates,
} from "./types";

export const UNIVERSITIES: University[] = [
  {
    name: "Columbia University",
    domain: "columbia.edu",
    safetyEmail: "safety@columbia.edu",
    color: "#003DA5",
  },
  {
    name: "New York University",
    domain: "nyu.edu",
    safetyEmail: "public.safety@nyu.edu",
    color: "#57068C",
  },
  {
    name: "The New School",
    domain: "newschool.edu",
    safetyEmail: "campussafety@newschool.edu",
    color: "#F0611E",
  },
  {
    name: "Fordham University",
    domain: "fordham.edu",
    safetyEmail: "dps@fordham.edu",
    color: "#991818",
  },
  {
    name: "Barnard College",
    domain: "barnard.edu",
    safetyEmail: "security@barnard.edu",
    color: "#003DA5",
  },
];

export function detectUniversity(email: string): University | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  return UNIVERSITIES.find((u) => domain.endsWith(u.domain)) ?? null;
}

export function getAlertRecipients(payload: AlertPayload): string[] {
  const recipients: string[] = [
    "alerts@safewalk.nyc", // Always notify our platform
  ];

  // Add the user's own email if provided
  if (payload.userEmail) {
    recipients.push(payload.userEmail);
  }

  // Route to university safety if detected
  if (payload.universityDomain) {
    const university = UNIVERSITIES.find((u) =>
      payload.universityDomain?.endsWith(u.domain)
    );
    if (university) {
      recipients.push(university.safetyEmail);
    }
  }

  return recipients;
}

export function formatAlertMessage(payload: AlertPayload): string {
  const locationUrl = `https://maps.google.com/?q=${payload.location.lat},${payload.location.lng}`;
  const time = new Date(payload.timestamp).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return `
SAFEWALK NYC — SAFETY ALERT
============================
Time: ${time}
Location: ${payload.location.lat.toFixed(6)}, ${payload.location.lng.toFixed(6)}
Maps: ${locationUrl}

Message: ${payload.message}

${payload.route ? `Route: ${payload.route.origin} → ${payload.route.destination}` : ""}

This alert was triggered via SafeWalk NYC.
  `.trim();
}

export function buildAlertSubject(university?: University): string {
  if (university) {
    return `[SafeWalk] Safety Alert — ${university.name} Student`;
  }
  return "[SafeWalk] Safety Alert — NYC User";
}

// ---------------------------------------------------------------------------
// Alert config
// ---------------------------------------------------------------------------

const COLUMBIA_CONFIG: ColumbiaAlertConfig = {
  university: "Columbia",
  emergencyNumber: "2128545555",
  campuses: {
    morningside: { phone: "2128545555", lat: 40.8075, lng: -73.9626 },
    manhattanville: { phone: "2128533333", lat: 40.817, lng: -73.9575 },
    medical: { phone: "2123057979", lat: 40.8405, lng: -73.9424 },
  },
  appDeepLink: "lionsafe://",
  escortService: true,
};

const NYU_CONFIG: AlertConfig = {
  university: "NYU",
  emergencyNumber: "2129982222",
  safeRidePhone: "9299305082",
  appDeepLink: "safenyu://",
  safeRideHours: { start: 0, end: 7 },
};

const GENERAL_CONFIG: AlertConfig = {
  university: null,
  emergencyNumber: "911",
  complaintLine: "311",
};

export function getAlertConfig(email: string): AlertConfig {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain.endsWith("columbia.edu")) return COLUMBIA_CONFIG;
  if (domain.endsWith("nyu.edu")) return NYU_CONFIG;
  return GENERAL_CONFIG;
}

// ---------------------------------------------------------------------------
// Closest Columbia campus
// ---------------------------------------------------------------------------

function haversineMiles(a: Coordinates, b: Coordinates): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

type CampusKey = keyof ColumbiaAlertConfig["campuses"];

export function getClosestCampus(
  userCoords: Coordinates
): { campus: CampusKey; info: ColumbiaCampus; distanceMiles: number } {
  const entries = Object.entries(COLUMBIA_CONFIG.campuses) as [
    CampusKey,
    ColumbiaCampus
  ][];

  const ranked = entries
    .map(([campus, info]) => ({
      campus,
      info,
      distanceMiles: haversineMiles(userCoords, { lat: info.lat, lng: info.lng }),
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  return ranked[0];
}

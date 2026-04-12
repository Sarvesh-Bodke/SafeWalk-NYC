export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Route {
  id: string;
  origin: string;
  destination: string;
  originCoords: Coordinates;
  destinationCoords: Coordinates;
  waypoints: Coordinates[];
  distanceMiles: number;
  durationMinutes: number;
  safetyScore: SafetyScore;
  geometry: GeoJSON.LineString;
}

export interface SafetyScore {
  overall: number; // 0–100
  crimeIndex: number;
  lightingIndex: number;
  trafficSignalDensity: number;
  recentIncidents: number;
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  crimeWeight: number;
  lightingWeight: number;
  trafficWeight: number;
  incidentWeight: number;
  explanation: string;
}

export interface CrimeIncident {
  id: string;
  type: string;
  description: string;
  coordinates: Coordinates;
  date: string;
  borough: string;
  precinct: number;
}

export interface TrafficSignal {
  id: string;
  coordinates: Coordinates;
  type: string;
  pedestrianExclusive: boolean;
}

export interface ThreeOneOneReport {
  id: string;
  type: string;
  description: string;
  coordinates: Coordinates;
  date: string;
  status: string;
}

export interface AlertPayload {
  userEmail?: string;
  universityDomain?: string;
  location: Coordinates;
  message: string;
  timestamp: string;
  route?: Partial<Route>;
}

export interface SignupPayload {
  email: string;
  university?: string;
  notifyAlerts: boolean;
}

export interface RouteRequest {
  origin: string;
  destination: string;
  preference: "safest" | "fastest" | "balanced";
}

export interface RouteScoreRequest {
  route: Route;
  includeExplanation?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface University {
  name: string;
  domain: string;
  safetyEmail: string;
  color: string;
}

// ---- Alert config (discriminated union by university) ----

export interface ColumbiaCampus {
  phone: string;
  lat: number;
  lng: number;
}

export interface ColumbiaAlertConfig {
  university: "Columbia";
  emergencyNumber: string;
  campuses: {
    morningside: ColumbiaCampus;
    manhattanville: ColumbiaCampus;
    medical: ColumbiaCampus;
  };
  appDeepLink: string;
  escortService: boolean;
}

export interface NYUAlertConfig {
  university: "NYU";
  emergencyNumber: string;
  safeRidePhone: string;
  appDeepLink: string;
  safeRideHours: { start: number; end: number }; // 24-hour integers, e.g. {start:0, end:7}
}

export interface GeneralAlertConfig {
  university: null;
  emergencyNumber: string;
  complaintLine: string;
}

export type AlertConfig = ColumbiaAlertConfig | NYUAlertConfig | GeneralAlertConfig;

// ---- Route segment ----

export interface RouteSegment {
  startCoords: Coordinates;
  endCoords: Coordinates;
  distanceMiles: number;
  durationMinutes: number;
  streetName?: string;
  safetyScore?: SafetyScore;
  geometry: GeoJSON.LineString;
  // Data fetched for scoring — populated before calling scoreSegment()
  crimes?: CrimeIncident[];
  streetlightComplaints?: ThreeOneOneReport[];
  trafficSignals?: TrafficSignal[];
  newsPenalty?: number; // 0–15, sourced from Linkup
}

// ---- User profile ----

export interface UserProfile {
  email?: string;
  university?: string;
  alertConfig?: AlertConfig;
  notifyAlerts: boolean;
  homeCoords?: Coordinates;
}

# SafeWalk NYC — Project Overview

AI-powered pedestrian safety routing for NYC, aimed at university students. Users describe their destination conversationally; the app returns route options scored against real-time crime, lighting, and traffic signal data, with Claude providing plain-English safety explanations.

## Stack

- **Framework**: Next.js 14 (App Router, TypeScript)
- **Styling**: Tailwind CSS
- **Map**: Mapbox GL JS (client-side only, `dynamic` import with `ssr: false`)
- **AI**: Anthropic Claude via `@anthropic-ai/sdk` — model `claude-sonnet-4-6`
- **Data**: NYC Open Data (NYPD complaints, 311, traffic signals)
- **Search**: Linkup API for neighborhood safety context

## Key Conventions

### Environment variables
- `ANTHROPIC_API_KEY` — server-side only
- `LINKUP_API_KEY` — server-side only
- `NEXT_PUBLIC_MAPBOX_TOKEN` — client-accessible (prefixed)

### File layout
```
/app
  /page.tsx                     Landing page with email signup
  /route-planner/page.tsx       Main app: map + chat sidebar
  /api/score-route/route.ts     POST — score a route against NYC data
  /api/alert/route.ts           POST — route safety alert to campus/email
/components
  MapView.tsx                   Mapbox map, dynamic import
  ChatInput.tsx                 Conversational destination input
  RouteCard.tsx                 Route option with safety score bars
  AlertButton.tsx               Persistent "I feel unsafe" button
  SignupForm.tsx                Email signup with university detection
/lib
  types.ts                      All shared TypeScript interfaces
  scoring.ts                    Composite safety score (0–100)
  alert-routing.ts              University email domain → campus safety routing
  /api/nyc-open-data.ts         NYC Open Data fetch helpers
  /api/linkup.ts                Linkup search wrapper
  /api/claude.ts                Claude API helpers (explain score, parse intent)
```

### Safety score (0–100)
Weights: **crime 45%, lighting 30%, traffic signals 15%, recent incidents 10%**

Score labels: ≥80 Safe (green), ≥60 Moderate (yellow), ≥40 Use Caution (orange), <40 High Risk (red)

### University detection
Email domain matching in `lib/alert-routing.ts`. Supported: Columbia, NYU, The New School, Fordham, Barnard. Alerts route to the relevant campus safety email.

### MapView
Always imported with `dynamic(() => import("@/components/MapView"), { ssr: false })` to avoid SSR failures from Mapbox's browser-only APIs.

### API routes
- `POST /api/score-route` — accepts `RouteScoreRequest`, returns `SafetyScore` + optional Claude explanation
- `POST /api/alert` — accepts `AlertPayload`, logs alert and returns recipients list (wire up SendGrid/Resend for production)

## Adding a new university
Append to the `UNIVERSITIES` array in `lib/alert-routing.ts`:
```ts
{ name: "...", domain: "...", safetyEmail: "...", color: "#hex" }
```

## TODO for production
- [ ] Wire up Mapbox Directions API to generate real route geometries
- [ ] Add email delivery via Resend or SendGrid in `app/api/alert/route.ts`
- [ ] Persist signups to a database (Supabase / PlanetScale)
- [x] Add a `/api/chat` route to serve `ChatInput.tsx` conversational messages
- [ ] Rate-limit API routes with `@upstash/ratelimit`

import Anthropic from "@anthropic-ai/sdk";
import { Route, SafetyScore, ChatMessage } from "../types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are SafeWalk NYC, an AI assistant helping students navigate New York City safely, especially at night.

When responding:
• Use plain text only — no markdown headers, no **bold**, no # symbols
• Use • bullet points for lists
• Keep responses under 120 words
• Be direct and specific

When a user mentions a destination or asks about a route, confirm you're looking it up and ask for their starting point if missing.

Safety scores range from 0 (very unsafe) to 100 (very safe). Higher scores = safer route.`;

export async function explainRouteScore(
  route: Route,
  score: SafetyScore
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Explain this safety score for a route from ${route.origin} to ${route.destination}:
Score: ${score.overall}/100
Crime index: ${score.crimeIndex}/100
Lighting index: ${score.lightingIndex}/100
Traffic signals: ${score.trafficSignalDensity}/100
Recent incidents: ${score.recentIncidents}

${score.breakdown.explanation}

Give a 2-3 sentence plain-English explanation for a student walking at night.`,
      },
    ],
  });

  const block = message.content[0];
  return block.type === "text" ? block.text : "";
}

export async function conversationalRouteAssist(
  messages: ChatMessage[],
  context?: { currentLocation?: string; destination?: string }
): Promise<string> {
  const systemWithContext = context
    ? `${SYSTEM_PROMPT}\n\nCurrent context: User is at ${context.currentLocation ?? "unknown location"}, wants to go to ${context.destination ?? "unknown destination"}.`
    : SYSTEM_PROMPT;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemWithContext,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

export async function generateSafetyBriefing(
  neighborhood: string,
  timeOfDay: "day" | "evening" | "night"
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Give a brief safety briefing for walking through ${neighborhood} in NYC at ${timeOfDay}. Include: typical foot traffic, lighting, and any precautions. Keep it under 3 sentences.`,
      },
    ],
  });

  const block = message.content[0];
  return block.type === "text" ? block.text : "";
}

export async function parseRouteIntent(userMessage: string): Promise<{
  origin?: string;
  destination?: string;
  preference?: "safest" | "fastest" | "balanced";
}> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: "Extract route information from user messages. Return JSON only.",
    messages: [
      {
        role: "user",
        content: `Extract origin, destination, and preference (safest/fastest/balanced) from: "${userMessage}". Return JSON like {"origin":"...","destination":"...","preference":"..."}. Use null for missing fields.`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== "text") return {};

  try {
    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }
}

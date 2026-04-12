import { NextRequest, NextResponse } from "next/server";
import { conversationalRouteAssist, parseRouteIntent } from "@/lib/api/claude";
import { ChatMessage } from "@/lib/types";

interface ChatRequest {
  messages: ChatMessage[];
  context?: {
    currentLocation?: string;
    destination?: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();
    const { messages, context } = body;

    if (!messages?.length) {
      return NextResponse.json({ error: "Messages are required" }, { status: 400 });
    }

    // Get the assistant reply
    const reply = await conversationalRouteAssist(messages, context);

    // Try to extract route intent from the latest user message
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    let route: { origin?: string; destination?: string; preference?: string } = {};

    if (lastUserMessage) {
      route = await parseRouteIntent(lastUserMessage.content);
    }

    return NextResponse.json({ reply, route });
  } catch (err) {
    console.error("[chat]", err);
    return NextResponse.json({ error: "Failed to process message" }, { status: 500 });
  }
}

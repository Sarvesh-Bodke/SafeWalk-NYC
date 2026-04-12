"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Navigation, Loader2 } from "lucide-react";
import { ChatMessage } from "@/lib/types";

interface ChatInputProps {
  onRouteExtracted?: (origin: string, destination: string) => void;
  placeholder?: string;
}

export default function ChatInput({ onRouteExtracted, placeholder = "Where do you want to go?" }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentLocation] = useState<string>("my location");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          context: { currentLocation },
        }),
      });

      const data = await res.json();

      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      }

      if (data.route?.origin && data.route?.destination) {
        onRouteExtracted?.(data.route.origin, data.route.destination);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't process that. Please try again." },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Message history */}
      {messages.length > 0 && (
        <div className="max-h-48 overflow-y-auto flex flex-col gap-2 pr-1">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`px-3 py-2 rounded-xl text-sm max-w-[85%] ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-white/10 text-gray-200 rounded-bl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded-xl bg-white/10 text-gray-400 text-sm flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Thinking...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2 bg-white/10 border border-white/20 rounded-2xl px-4 py-3 focus-within:border-blue-400 transition-colors">
        <Navigation className="w-4 h-4 text-gray-400 shrink-0 mb-0.5" />
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 bg-transparent text-white placeholder-gray-400 text-sm resize-none focus:outline-none leading-relaxed"
          style={{ maxHeight: "100px" }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="shrink-0 p-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-gray-500 pl-1">
        Try: &ldquo;Walk me from 116th and Broadway to the Times Square subway&rdquo;
      </p>
    </div>
  );
}

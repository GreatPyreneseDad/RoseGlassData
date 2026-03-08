"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPanel({ analysisId }: { analysisId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMessage: Message = { role: "user", content: text };
    const updatedHistory = [...messages, userMessage];
    setMessages(updatedHistory);
    setInput("");
    setStreaming(true);

    // Add placeholder for assistant
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis_id: analysisId,
          message: text,
          history: messages,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: `Error: ${err.error || "Request failed"}`,
          };
          return copy;
        });
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const stripped = line.replace(/^data: /, "");
          if (stripped === "[DONE]") continue;
          if (!stripped) continue;

          try {
            const parsed = JSON.parse(stripped);
            if (parsed.content) {
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = {
                  ...last,
                  content: last.content + parsed.content,
                };
                return copy;
              });
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Connection failed"}`,
        };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-teal-500" />
        <h3 className="text-sm font-semibold text-white">Ask Rose Glass</h3>
      </div>

      <div className="h-96 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-slate-600 text-center mt-8">
            Ask about the story, the sources, or what the dimensions reveal.
          </p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-teal-600/20 text-teal-100"
                  : "bg-slate-800 text-slate-200"
              }`}
            >
              {msg.content}
              {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                <span className="inline-block w-1.5 h-4 bg-teal-400 ml-0.5 animate-pulse" />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-800 p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask about this story..."
          disabled={streaming}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-500 transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 text-sm font-medium rounded-lg transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}

import { useRef, useEffect, useState } from "react";
import type { Message } from "ai/react";

import MessageBubble from "./message";
import { useGameStore } from "../../lib/state/use-game-store";

export interface PendingQuestion {
  id: string;
  content: string;
}

export interface TutorProps {
  messages: Message[];
  isLoading: boolean;
  send: (text: string) => void;
  pending: PendingQuestion[];
}

export default function Tutor({ messages, send, isLoading, pending }: TutorProps) {
  const { gameOver } = useGameStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pending]);

  const submitQuestion = (event: React.FormEvent): void => {
    event.preventDefault();

    const text = input.trim();

    if (!text) {
      return;
    }

    send(text);
    setInput("");

    // programmatic clearing bypasses onChange - reset the auto-grown height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="paper flex h-full flex-col overflow-hidden rounded-xl border border-[#D8D0BC] text-[#1F241F] shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
      <header className="flex items-center justify-between border-b border-[#D8D0BC] px-5 py-4">
        <div>
          <h1 className="font-serif text-lg font-bold text-[#1F241F]">Chess Tutor</h1>
          <p className="text-xs text-[#57503F]">与 AI 教练 kaspar0v 对弈学棋</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            isLoading
              ? "animate-pulse bg-[#F3D9C9] text-[#B3402A]"
              : pending.length > 0
                ? "bg-[#F0E4C8] text-[#8B5E17]"
                : "bg-[#DCE9DC] text-[#2F5A47]"
          }`}
        >
          {isLoading ? "回复中…" : pending.length > 0 ? `${pending.length} 条排队中` : "在线"}
        </span>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ol className="flex flex-col gap-4">
          {messages.map((message, index) => {
            if (message.role === "user") {
              // the full content carries the position context for the LLM;
              // the bubble shows only the human-readable first paragraph
              const question = String(message.content).split("\n\n")[0];
              return (
                <li key={index} className="flex items-end justify-end gap-2">
                  <div className="user-message max-w-[85%] rounded-xl p-3 text-sm whitespace-pre-wrap break-words">
                    {question}
                  </div>
                  <span className="flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full border border-[#C9C0AA] bg-[#F2EDE0] text-xs font-bold text-[#3A362C]">
                    你
                  </span>
                </li>
              );
            }

            if (message.role === "system") {
              return (
                <li key={index} className="flex justify-center">
                  <span className="rounded-full bg-[#E7E0CE] px-3 py-1 text-xs font-medium text-[#6B6455]">
                    {message.content as string}
                  </span>
                </li>
              );
            }

            return (
              <li key={index} className="flex items-start gap-2">
                <span className="mt-1 flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full bg-[#2F5A47] font-serif text-xs font-bold text-[#F2EDE0]">
                  K
                </span>
                <div className="min-w-0 flex-1">
                  <MessageBubble content={message.content as string} />
                </div>
              </li>
            );
          })}
          {pending.map((item) => (
            <li key={item.id} className="flex items-end justify-end gap-2">
              <div className="user-message max-w-[85%] rounded-xl p-3 text-sm whitespace-pre-wrap break-words opacity-60">
                {item.content.split("\n\n")[0]}
                <span className="mt-1 block text-xs italic">⏳ 排队中…</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <form className="flex items-end gap-2 border-t border-[#D8D0BC] p-3" onSubmit={submitQuestion}>
        <textarea
          ref={textareaRef}
          rows={1}
          className="max-h-32 min-h-[38px] flex-1 resize-none rounded-lg border border-[#C9C0AA] bg-white px-3 py-2 text-sm leading-5 text-[#1F241F] outline-none transition placeholder:text-[#8A8271] focus:border-[#B0782C] focus:ring-2 focus:ring-[#B0782C]/20"
          placeholder={isLoading ? "教练正在回复…现在发送的消息将排队" : "问教练任何问题，Enter 发送，Shift+Enter 换行…"}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);

            // auto-grow with content, clamped by max-h
            event.target.style.height = "auto";
            event.target.style.height = `${event.target.scrollHeight}px`;
          }}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter inserts a newline
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={gameOver}
        />
        <button
          type="submit"
          disabled={gameOver || !input.trim()}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-[#F2EDE0] shadow-sm transition-colors ${
            gameOver || !input.trim() ? "cursor-not-allowed bg-[#C9C0AA] text-[#8A8271]" : "cursor-pointer bg-[#2F5A47] hover:bg-[#24483A]"
          }`}
        >
          发送
        </button>
      </form>
    </div>
  );
}

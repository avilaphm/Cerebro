'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// Problem-led shortcuts. Each card sends a fuller sentence so the bot has
// something concrete to reflect on. Mirrors the noun list in the landing
// page's Reality section: invoices, follow-ups, onboarding, reports.
const SUGGESTED_ACTIONS = [
  {
    title: "I'm losing leads",
    label: 'after hours.',
    action: "I'm losing leads after hours. People reach out at night and we don't get back to them until the next day.",
  },
  {
    title: 'Onboarding eats',
    label: 'my whole week.',
    action: "Onboarding eats my whole week. Every new client is forms, emails, and reminders, all manual.",
  },
  {
    title: 'My admin is',
    label: 'out of control.',
    action: "My admin is out of control. Too many tools, too many things to track, too much manual updating.",
  },
  {
    title: 'Reports take',
    label: 'forever.',
    action: "Reports take forever. I spend hours every week pulling numbers together for clients.",
  },
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-sm">
        <div className="flex gap-1 items-center h-4">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-1.5 h-1.5 bg-black/40 rounded-full animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function GetInTouchSection() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [leadCaptureTriggered, setLeadCaptureTriggered] = useState(false);
  const [leadCaptured, setLeadCaptured] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const captureCalledRef = useRef(false);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (!isTyping && messages.length > 0) {
      textareaRef.current?.focus();
    }
  }, [isTyping, messages.length]);

  const adjustTextarea = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  const triggerCapture = useCallback(
    async (msgs: Message[]) => {
      if (captureCalledRef.current) return;
      captureCalledRef.current = true;
      setLeadCaptureTriggered(true);

      try {
        await fetch(`${supabaseUrl}/functions/v1/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            action: 'capture',
            messages: msgs.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        setLeadCaptured(true);
      } catch (err) {
        console.error('Lead capture failed:', err);
        captureCalledRef.current = false;
        setLeadCaptureTriggered(false);
      }
    },
    [supabaseUrl, supabaseAnonKey],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isTyping) return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
      };

      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setIsTyping(true);

      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            action: 'chat',
            messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        const data = await res.json();
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.text || 'Something went wrong. Please try again.',
        };

        const finalMessages = [...nextMessages, assistantMsg];
        setMessages(finalMessages);

        // Trigger capture once: when the user's most recent message contains an
        // email address, they've just answered the bot's "best email to send the
        // plan to?" prompt. Checking only the last user message (not the whole
        // transcript) avoids false triggers if an email gets reflected back.
        if (!captureCalledRef.current) {
          const lastUser = [...finalMessages]
            .reverse()
            .find((m) => m.role === 'user');
          if (lastUser && EMAIL_REGEX.test(lastUser.content)) {
            triggerCapture(finalMessages);
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Sorry, something went wrong. Please try again.',
          },
        ]);
      } finally {
        setIsTyping(false);
      }
    },
    [messages, isTyping, supabaseUrl, supabaseAnonKey, triggerCapture],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const showSuggestions = messages.length === 0 && !isTyping;

  return (
    <div className="w-full max-w-2xl">

      {/* Conversation history */}
      {messages.length > 0 && (
        <div className="mb-5 space-y-3 max-h-[380px] overflow-y-auto pr-1 scroll-smooth">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[82%] px-4 py-3 text-sm font-light leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-black text-white rounded-2xl rounded-br-sm'
                    : 'bg-gray-100 text-black rounded-2xl rounded-bl-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isTyping && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Suggestion cards */}
      {showSuggestions && (
        <div className="grid grid-cols-2 gap-2 mb-5">
          {SUGGESTED_ACTIONS.map((s) => (
            <button
              key={s.action}
              onClick={() => sendMessage(s.action)}
              className="text-left border border-gray-300 bg-white hover:bg-gray-50 rounded-xl px-4 py-3 text-sm transition-colors duration-150"
            >
              <span className="block font-medium text-black">{s.title}</span>
              <span className="block text-black/50">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            adjustTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder="What's eating your week?"
          disabled={isTyping}
          rows={1}
          className="w-full resize-none rounded-2xl border border-gray-300 bg-white px-4 py-3 pr-12 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50"
          style={{ overflow: 'hidden' }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isTyping}
          aria-label="Send message"
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black text-white transition-opacity hover:opacity-75 disabled:opacity-25"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M8.70711 1.39644C8.31659 1.00592 7.68342 1.00592 7.2929 1.39644L2.21968 6.46966L1.68935 6.99999L2.75001 8.06065L3.28034 7.53032L7.25001 3.56065V14.25V15H8.75001V14.25V3.56065L12.7197 7.53032L13.25 8.06065L14.3107 6.99999L13.7803 6.46966L8.70711 1.39644Z"
            />
          </svg>
        </button>
      </div>

      {/* Hint text */}
      {messages.length === 0 && (
        <p className="mt-3 text-[0.65rem] tracking-[0.08em] uppercase text-black/30">
          Enter to send · Shift+Enter for new line
        </p>
      )}

      {/* Lead captured confirmation */}
      {leadCaptured && (
        <p className="mt-4 text-xs text-black/50">
          Pedro will be in touch within 24 hours.
        </p>
      )}
    </div>
  );
}

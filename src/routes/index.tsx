import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Volume2,
  Sun,
  Wifi,
  Bluetooth,
  Moon,
  Mail,
  AppWindow,
  Brain,
  Send,
  Trash2,
  Terminal,
} from "lucide-react";
import {
  think,
  defaultState,
  demoEmails,
  type Message,
  type Memory,
  type SystemState,
} from "@/lib/elton-brain";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Elton — Jarvis-style AI Assistant Demo" },
      { name: "description", content: "Live demo of Elton, a voice-activated Jarvis-style assistant: wake word, speech-to-text, text-to-speech, app control, email and memory." },
      { property: "og:title", content: "Elton — Jarvis-style AI Assistant Demo" },
      { property: "og:description", content: "Voice-activated assistant demo with wake word, speech, system control and memory." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EltonDemo,
});

type Status = "idle" | "listening" | "thinking" | "speaking";
const MEM_KEY = "elton.memory.v1";
const uid = () => Math.random().toString(36).slice(2);

type SR = {
  new (): SR;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function EltonDemo() {
  const [status, setStatus] = useState<Status>("idle");
  const [micOn, setMicOn] = useState(false);
  const [supported, setSupported] = useState(true);
  const [voiceOut, setVoiceOut] = useState(true);
  const [interim, setInterim] = useState("");
  const [input, setInput] = useState("");
  const [state, setState] = useState<SystemState>(defaultState);
  const [memory, setMemory] = useState<Memory>({ facts: {}, history: [] });
  const [messages, setMessages] = useState<Message[]>([
    { id: uid(), role: "elton", text: "Systems online. Say “Hey Elton” or type a command.", at: Date.now() },
  ]);
  const [log, setLog] = useState<string[]>(["boot: wake-word engine ready", "boot: stt ready", "boot: tts ready"]);

  const recRef = useRef<SR | null>(null);
  const micOnRef = useRef(false);
  const stateRef = useRef(state);
  const memRef = useRef(memory);
  const listRef = useRef<HTMLDivElement>(null);
  stateRef.current = state;
  memRef.current = memory;

  // Load memory
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MEM_KEY);
      if (saved) setMemory(JSON.parse(saved) as Memory);
    } catch { /* ignore */ }
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    localStorage.setItem(MEM_KEY, JSON.stringify(memory));
  }, [memory]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, interim]);

  const addLog = (line: string) => setLog((l) => [...l.slice(-40), `${new Date().toLocaleTimeString([], { hour12: false })} ${line}`]);

  const speak = useCallback((text: string) => {
    if (!voiceOut || typeof speechSynthesis === "undefined") { setStatus(micOnRef.current ? "listening" : "idle"); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const pick = voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|george|ryan/i.test(v.name)) || voices.find((v) => /en-GB/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang));
    if (pick) u.voice = pick;
    u.rate = 1.02; u.pitch = 0.9;
    u.onstart = () => setStatus("speaking");
    u.onend = () => setStatus(micOnRef.current ? "listening" : "idle");
    speechSynthesis.speak(u);
  }, [voiceOut]);

  const handleCommand = useCallback((text: string) => {
    if (!text.trim()) return;
    setStatus("thinking");
    const userMsg: Message = { id: uid(), role: "user", text, at: Date.now() };
    setMessages((m) => [...m, userMsg]);
    addLog(`stt: "${text}"`);
    setTimeout(() => {
      const res = think(text, stateRef.current, memRef.current);
      setState(res.state);
      const reply: Message = { id: uid(), role: "elton", text: res.reply, at: Date.now(), tool: res.tool };
      setMemory({ ...res.memory, history: [...res.memory.history, userMsg, reply].slice(-50) });
      setMessages((m) => [...m, reply]);
      if (res.tool) addLog(`tool: ${res.tool}`);
      addLog(`tts: "${res.reply.slice(0, 60)}${res.reply.length > 60 ? "…" : ""}"`);
      speak(res.reply);
    }, 450);
  }, [speak]);

  const stopMic = useCallback(() => {
    micOnRef.current = false;
    setMicOn(false);
    recRef.current?.stop();
    recRef.current = null;
    setInterim("");
    setStatus("idle");
    addLog("mic: off");
  }, []);

  const startMic = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { setSupported(false); return; }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const tr = r?.[0]?.transcript ?? "";
        if (r?.isFinal) finalText += tr; else interimText += tr;
      }
      setInterim(interimText);
      if (finalText) {
        const lower = finalText.toLowerCase();
        const idx = lower.indexOf("elton");
        if (idx !== -1) {
          addLog("wake: “elton” detected");
          const cmd = finalText.slice(idx + 5).replace(/^[,.!\s]+/, "").trim();
          if (cmd) handleCommand(cmd); else { setMessages((m) => [...m, { id: uid(), role: "elton", text: "Yes?", at: Date.now() }]); speak("Yes?"); }
        } else {
          addLog(`heard (no wake word): "${finalText.trim()}"`);
        }
        setInterim("");
      }
    };
    rec.onerror = (e) => { addLog(`stt error: ${e.error}`); if (e.error === "not-allowed") stopMic(); };
    rec.onend = () => { if (micOnRef.current) { try { rec.start(); } catch { /* ignore */ } } };
    rec.start();
    recRef.current = rec;
    micOnRef.current = true;
    setMicOn(true);
    setStatus("listening");
    addLog("mic: on — listening for wake word");
  }, [handleCommand, speak, stopMic]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    handleCommand(input);
    setInput("");
  };

  const clearMemory = () => {
    setMemory({ facts: {}, history: [] });
    setMessages([{ id: uid(), role: "elton", text: "Memory cleared. Fresh start.", at: Date.now() }]);
    addLog("memory: cleared");
  };

  const quick = ["Open Spotify", "Read my emails", "Set volume to 30", "Turn off Wi-Fi", "My name is Alex", "System status"];
  const facts = Object.entries(memory.facts);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="elton-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[320px_1fr_300px] lg:px-8">
        {/* LEFT: system panel */}
        <aside className="space-y-4">
          <header>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">E.L.T.O.N.</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Personal Assistant</h1>
            <p className="text-sm text-muted-foreground">Browser demo · runs fully offline</p>
          </header>

          <Panel title="System" icon={<AppWindow className="size-4" />}>
            <Meter icon={<Volume2 className="size-4" />} label="Volume" value={state.volume} />
            <Meter icon={<Sun className="size-4" />} label="Brightness" value={state.brightness} />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Toggle icon={<Wifi className="size-4" />} label="Wi-Fi" on={state.wifi} />
              <Toggle icon={<Bluetooth className="size-4" />} label="BT" on={state.bluetooth} />
              <Toggle icon={<Moon className="size-4" />} label="Dark" on={state.darkMode} />
            </div>
          </Panel>

          <Panel title="Running apps" icon={<AppWindow className="size-4" />}>
            {state.openApps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No apps open. Try “open Chrome”.</p>
            ) : (
              <ul className="space-y-1.5">
                {state.openApps.map((a) => (
                  <li key={a} className="flex items-center gap-2 rounded-md bg-accent/60 px-2.5 py-1.5 text-sm">
                    <span className="size-1.5 rounded-full bg-primary" /> {a}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Inbox" icon={<Mail className="size-4" />}>
            <ul className="space-y-2">
              {demoEmails.map((e) => (
                <li key={e.subject} className="text-sm">
                  <div className="flex items-center gap-2">
                    {e.unread && <span className="size-1.5 rounded-full bg-primary" />}
                    <span className={e.unread ? "font-medium" : "text-muted-foreground"}>{e.from}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{e.subject}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>

        {/* CENTER: orb + conversation */}
        <section className="flex min-h-[80vh] flex-col rounded-2xl border border-border bg-card/60 backdrop-blur">
          <div className="flex flex-col items-center gap-3 border-b border-border px-6 py-6">
            <Orb status={status} />
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
              {status === "idle" && "standby"}
              {status === "listening" && "listening for “hey elton”"}
              {status === "thinking" && "processing"}
              {status === "speaking" && "speaking"}
            </p>
            {interim && <p className="text-sm italic text-muted-foreground">…{interim}</p>}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={micOn ? stopMic : startMic}
                disabled={!supported}
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition ${micOn ? "bg-primary text-primary-foreground shadow-[0_0_24px_var(--color-primary)]" : "border border-border bg-secondary hover:bg-accent"} disabled:opacity-50`}
              >
                {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
                {micOn ? "Mic on" : "Enable voice"}
              </button>
              <button
                onClick={() => setVoiceOut((v) => !v)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-2 text-sm hover:bg-accent"
              >
                <Volume2 className="size-4" /> Voice {voiceOut ? "on" : "off"}
              </button>
            </div>
            {!supported && (
              <p className="text-xs text-destructive">Speech recognition needs Chrome or Edge. Typing still works.</p>
            )}
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-secondary"}`}>
                  <p>{m.text}</p>
                  {m.tool && <p className="mt-1.5 font-mono text-[11px] text-primary/80">▸ {m.tool}</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border px-6 py-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {quick.map((q) => (
                <button key={q} onClick={() => handleCommand(q)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-primary hover:text-primary">
                  {q}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a command for Elton…"
                className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Send className="size-4" /> Send
              </button>
            </form>
          </div>
        </section>

        {/* RIGHT: memory + log */}
        <aside className="space-y-4">
          <Panel
            title="Memory"
            icon={<Brain className="size-4" />}
            action={
              <button onClick={clearMemory} title="Clear memory" className="text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </button>
            }
          >
            {facts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing stored. Say “my name is …” or “remember that …”.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {facts.map(([k, v]) => (
                  <li key={k} className="rounded-md bg-accent/60 px-2.5 py-1.5">
                    <span className="font-mono text-[11px] uppercase text-primary/80">{k}</span>
                    <p>{v}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{memory.history.length} turns in conversation history · persisted locally</p>
          </Panel>

          <Panel title="Event log" icon={<Terminal className="size-4" />}>
            <div className="max-h-[420px] space-y-1 overflow-y-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
              {log.map((l, i) => (
                <p key={i} className={l.includes("tool:") ? "text-primary" : l.includes("wake:") ? "text-accent-foreground" : ""}>{l}</p>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </main>
  );
}

function Orb({ status }: { status: Status }) {
  const active = status !== "idle";
  return (
    <div className="relative flex size-40 items-center justify-center">
      <div className="elton-orb-ring absolute inset-0 rounded-full border border-dashed border-primary/40" />
      <div className="elton-orb-ring-rev absolute inset-3 rounded-full border border-primary/30 border-t-primary" />
      <div className={`elton-orb-core ${active ? "active" : ""} size-20 rounded-full bg-primary shadow-[0_0_60px_var(--color-primary)]`} style={{ opacity: status === "thinking" ? 0.5 : undefined }} />
      <div className="absolute size-8 rounded-full bg-background/40" />
    </div>
  );
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">{icon} {title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Meter({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">{icon} {label}</span>
        <span className="font-mono">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Toggle({ icon, label, on }: { icon: React.ReactNode; label: string; on: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs transition ${on ? "border-primary/60 bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}>
      {icon}
      <span>{label}</span>
      <span className="font-mono text-[10px]">{on ? "ON" : "OFF"}</span>
    </div>
  );
}

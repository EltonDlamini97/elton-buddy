// Elton's local "brain": intent parsing, simulated tools and conversation memory.
// Runs entirely in the browser — no keys required.

export type Role = "user" | "elton" | "system";

export interface Message {
  id: string;
  role: Role;
  text: string;
  at: number;
  tool?: string;
}

export interface SystemState {
  volume: number;
  brightness: number;
  wifi: boolean;
  bluetooth: boolean;
  darkMode: boolean;
  openApps: string[];
}

export interface Memory {
  facts: Record<string, string>;
  history: Message[];
}

export const defaultState: SystemState = {
  volume: 60,
  brightness: 80,
  wifi: true,
  bluetooth: false,
  darkMode: true,
  openApps: [],
};

export const demoEmails = [
  { from: "Sarah Nkosi", subject: "Q3 roadmap review — Thursday 10am", unread: true },
  { from: "GitHub", subject: "[elton-assistant] CI passed on main", unread: true },
  { from: "Dad", subject: "Braai this weekend?", unread: true },
  { from: "Takealot", subject: "Your order has shipped", unread: false },
];

const APPS: Record<string, string> = {
  chrome: "Google Chrome",
  browser: "Google Chrome",
  spotify: "Spotify",
  music: "Spotify",
  "vs code": "Visual Studio Code",
  vscode: "Visual Studio Code",
  code: "Visual Studio Code",
  notepad: "Notepad",
  calculator: "Calculator",
  explorer: "File Explorer",
  files: "File Explorer",
  terminal: "Windows Terminal",
  word: "Microsoft Word",
  excel: "Microsoft Excel",
  outlook: "Outlook",
  discord: "Discord",
  slack: "Slack",
  teams: "Microsoft Teams",
  settings: "Windows Settings",
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export interface BrainResult {
  reply: string;
  tool?: string | undefined;
  state: SystemState;
  memory: Memory;
}

export function think(input: string, state: SystemState, memory: Memory): BrainResult {
  const raw = input.trim();
  const t = raw.toLowerCase().replace(/^(hey |ok |okay )?elton[,!.]?\s*/, "");
  const name = memory.facts["name"];
  const s: SystemState = { ...state, openApps: [...state.openApps] };
  const m: Memory = { ...memory, facts: { ...memory.facts } };
  const done = (reply: string, tool?: string): BrainResult => ({ reply, tool, state: s, memory: m });

  // --- memory: remember / recall ---
  let mm = t.match(/my name is (\w+)/) || t.match(/call me (\w+)/);
  if (mm) {
    const n = mm[1] ?? "";
    m.facts["name"] = n.charAt(0).toUpperCase() + n.slice(1);
    return done(`Nice to meet you, ${m.facts["name"]}. I'll remember that.`, "memory.store");
  }
  mm = t.match(/remember (?:that )?(.+)/);
  if (mm) {
    const key = `note_${Object.keys(m.facts).length + 1}`;
    const note = mm[1] ?? "";
    m.facts[key] = note;
    return done(`Noted. I'll remember that ${note}.`, "memory.store");
  }
  if (/what(?:'s| is) my name/.test(t)) {
    return name
      ? done(`Your name is ${name}.`, "memory.recall")
      : done("You haven't told me your name yet. Just say “my name is …”.", "memory.recall");
  }
  if (/what do you remember|what have i told you/.test(t)) {
    const notes = Object.entries(m.facts).map(([k, v]) => (k === "name" ? `your name is ${v}` : v));
    return done(notes.length ? `Here's what I remember: ${notes.join("; ")}.` : "Nothing yet — tell me something to remember.", "memory.recall");
  }
  if (/forget everything|clear (your )?memory/.test(t)) {
    m.facts = {};
    return done("Memory wiped. Fresh start.", "memory.clear");
  }

  // --- apps ---
  mm = t.match(/(?:open|launch|start|run) (?:up )?(?:the )?([\w .]+?)(?: for me| please)?$/);
  if (mm) {
    const target = mm[1] ?? "";
    const key = Object.keys(APPS).find((k) => target.includes(k));
    const app = (key && APPS[key]) || target.replace(/\b\w/g, (c) => c.toUpperCase());
    if (!s.openApps.includes(app)) s.openApps.push(app);
    return done(`Opening ${app} now.`, `os.open_app("${app}")`);
  }
  mm = t.match(/(?:close|quit|kill|exit) (?:the )?([\w .]+?)(?: for me| please)?$/);
  if (mm) {
    const target = mm[1] ?? "";
    const key = Object.keys(APPS).find((k) => target.includes(k));
    const app = (key && APPS[key]) || target;
    const idx = s.openApps.findIndex((a) => a.toLowerCase() === app.toLowerCase());
    if (idx === -1) return done(`${app} isn't running right now.`, "os.close_app");
    s.openApps.splice(idx, 1);
    return done(`Closed ${app}.`, `os.close_app("${app}")`);
  }
  if (/what(?:'s| is) (?:open|running)/.test(t)) {
    return done(s.openApps.length ? `Currently running: ${s.openApps.join(", ")}.` : "Nothing is open at the moment.", "os.list_apps");
  }

  // --- email ---
  if (/(read|check|any|new|unread).*(email|mail|inbox)|(email|mail|inbox)/.test(t)) {
    const unread = demoEmails.filter((e) => e.unread);
    if (!unread.length) return done("Your inbox is clear — no unread emails.", "email.fetch");
    const list = unread.map((e, i) => `${i + 1}. From ${e.from}: “${e.subject}”`).join(". ");
    return done(`You have ${unread.length} unread emails. ${list}.`, "email.fetch(unread=true)");
  }

  // --- volume ---
  mm = t.match(/(?:set )?volume (?:to )?(\d+)/);
  if (mm) { s.volume = clamp(Number(mm[1])); return done(`Volume set to ${s.volume} percent.`, `os.set_volume(${s.volume})`); }
  if (/(turn|volume) (it )?up|louder|increase (the )?volume/.test(t)) { s.volume = clamp(s.volume + 10); return done(`Volume up to ${s.volume}.`, `os.set_volume(${s.volume})`); }
  if (/(turn|volume) (it )?down|quieter|lower (the )?volume|decrease (the )?volume/.test(t)) { s.volume = clamp(s.volume - 10); return done(`Volume down to ${s.volume}.`, `os.set_volume(${s.volume})`); }
  if (/\bmute\b/.test(t)) { s.volume = 0; return done("Muted.", "os.set_volume(0)"); }
  if (/unmute/.test(t)) { s.volume = 50; return done("Unmuted, volume at 50.", "os.set_volume(50)"); }

  // --- brightness ---
  mm = t.match(/brightness (?:to )?(\d+)/);
  if (mm) { s.brightness = clamp(Number(mm[1])); return done(`Brightness set to ${s.brightness} percent.`, `os.set_brightness(${s.brightness})`); }
  if (/brighter|brightness up|increase (the )?brightness/.test(t)) { s.brightness = clamp(s.brightness + 15); return done(`Brightness up to ${s.brightness}.`, `os.set_brightness(${s.brightness})`); }
  if (/dimmer|brightness down|lower (the )?brightness|dim (the )?screen/.test(t)) { s.brightness = clamp(s.brightness - 15); return done(`Dimmed to ${s.brightness}.`, `os.set_brightness(${s.brightness})`); }

  // --- toggles ---
  mm = t.match(/(?:turn |switch )?(on|off|enable|disable) (?:the )?(wi-?fi|bluetooth|dark mode)/) || t.match(/(?:turn |switch )?(wi-?fi|bluetooth|dark mode) (on|off)/);
  if (mm) {
    const words = [mm[1] ?? "", mm[2] ?? ""];
    const on = words.some((w) => /^(on|enable)$/.test(w));
    const which = words.find((w) => /wi|blue|dark/.test(w)) ?? "wifi";
    const key = which.startsWith("wi") ? "wifi" : which.startsWith("blue") ? "bluetooth" : "darkMode";
    s[key] = on;
    const label = key === "wifi" ? "Wi-Fi" : key === "bluetooth" ? "Bluetooth" : "Dark mode";
    return done(`${label} is now ${on ? "on" : "off"}.`, `os.toggle("${key}", ${on})`);
  }

  // --- time / date ---
  if (/what time|the time/.test(t)) return done(`It's ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, "clock.now");
  if (/what(?:'s| is) (?:the |today's )?date|what day/.test(t)) return done(`Today is ${new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}.`, "clock.today");

  // --- status ---
  if (/status|system report|how(?:'s| is) the system/.test(t)) {
    return done(`All systems nominal. Volume ${s.volume}, brightness ${s.brightness}, Wi-Fi ${s.wifi ? "on" : "off"}, Bluetooth ${s.bluetooth ? "on" : "off"}, ${s.openApps.length} apps running.`, "os.status");
  }

  // --- small talk ---
  if (/^(hi|hello|hey|good (morning|afternoon|evening))/.test(t)) {
    const h = new Date().getHours();
    const g = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    return done(`${g}${name ? `, ${name}` : ""}. How can I help?`);
  }
  if (/how are you/.test(t)) return done("Running at full capacity. All subsystems green.");
  if (/who are you|your name/.test(t)) return done("I'm Elton, your personal assistant. I can open apps, read email, adjust system settings, and remember things for you.");
  if (/thank/.test(t)) return done(`Anytime${name ? `, ${name}` : ""}.`);
  if (/what can you do|help/.test(t)) {
    return done("Try: “open Spotify”, “read my emails”, “set volume to 30”, “turn off Wi-Fi”, “my name is Alex”, “what do you remember”, or “system status”.");
  }
  if (/joke/.test(t)) return done("Why did the neural network break up with the database? Too many unresolved dependencies.");

  return done(`I heard “${raw}”, but I don't have a tool for that yet. Say “help” to see what I can do.`);
}

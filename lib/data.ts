import { Sparkles, Zap, Code2, Eye, Package, Download } from "lucide-react";

export const SUGGESTIONS = [
  "A Spotify stats dashboard with charts",
  "A kanban board with drag and drop",
  "A weather app with animated icons",
  "A personal finance tracker",
  "A recipe finder with filters",
  "A pomodoro timer with tasks",
];

export const FEATURES = [
  {
    icon: Zap,
    label: "Instant generation",
    desc: "Describe your app in plain English and generate React and Tailwind code with your chosen model.",
  },
  {
    icon: Eye,
    label: "Live preview",
    desc: "Your app renders in the browser via Sandpack. No install and no local build step.",
  },
  {
    icon: Code2,
    label: "Full source code",
    desc: "Browse every generated file in a read-only code view. Ask in chat for changes; the preview updates after a successful build.",
  },
  {
    icon: Package,
    label: "Registry-checked packages",
    desc: "The model may request npm packages. Drevo checks each name and version against the npm registry and rejects ones that are not published.",
  },
  {
    icon: Sparkles,
    label: "AI error recovery",
    desc: "When the preview throws, a banner shows the error. Fix with AI sends that error back to your model.",
  },
  {
    icon: Download,
    label: "Export the project",
    desc: "Download a ZIP of the generated files, or push them to a GitHub repository you control.",
  },
];

export const STEPS = [
  {
    number: "01",
    label: "Describe your app",
    desc: "Type a prompt or pick a suggestion. Generation runs in the desktop workspace.",
  },
  {
    number: "02",
    label: "AI generates code",
    desc: "Your selected model writes React and Tailwind components, picks dependencies, and structures your files.",
  },
  {
    number: "03",
    label: "Preview and refine",
    desc: "See your app in the live preview. Keep chatting to iterate on the recent conversation.",
  },
  {
    number: "04",
    label: "Download or push",
    desc: "Download a ZIP or push the project to GitHub. You deploy it from there.",
  },
];

export const PLACEHOLDERS = [
  "A task manager with drag and drop…",
  "A portfolio tracker with charts…",
  "A notes app with live preview…",
  "An expense tracker by month…",
  "A habit tracker with streaks…",
];

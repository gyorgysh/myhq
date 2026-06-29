import {
  BookOpen,
  Pencil,
  FileEdit,
  Zap,
  Search,
  FolderOpen,
  Globe,
  Handshake,
  HelpCircle,
  Megaphone,
  Lightbulb,
  ListChecks,
  Paperclip,
  Brain,
  Wrench,
  ClipboardList,
  MessageSquare,
  Mic,
  Inbox,
  Image,
  CheckCircle2,
  AlarmClock,
  Timer,
  HeartPulse,
  RefreshCw,
  BarChart3,
  Sparkles,
  Rocket,
  MonitorCheck,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

/**
 * Shared Lucide icon lookups for the Activity feed and run transcripts. Keeps a
 * single source of truth so the two views stay visually consistent and we avoid
 * emoji as UI chrome.
 */

/** Map a (leaf) tool name to its Lucide icon. */
export function toolIcon(tool: string): LucideIcon {
  const leaf = tool.replace(/^mcp__[^_]+__/, "");
  switch (leaf) {
    case "Read":
      return BookOpen;
    case "Write":
      return Pencil;
    case "Edit":
    case "NotebookEdit":
      return FileEdit;
    case "Bash":
      return Zap;
    case "Grep":
      return Search;
    case "Glob":
      return FolderOpen;
    case "WebFetch":
    case "WebSearch":
      return Globe;
    case "Task":
    case "crew_delegate":
      return Handshake;
    case "crew_ask_president":
      return HelpCircle;
    case "crew_report":
      return Megaphone;
    case "crew_suggest":
      return Lightbulb;
    case "TodoWrite":
      return ListChecks;
    case "send_file":
      return Paperclip;
    default:
      if (leaf.startsWith("memory_")) return Brain;
      if (leaf.startsWith("skill_")) return Wrench;
      if (leaf.startsWith("task_")) return ClipboardList;
      return Wrench;
  }
}

/**
 * Semantic colour class for a tool's activity-feed icon, by category. Gives the
 * feed visual hierarchy instead of a flat `text-fg-dim` for every row. All
 * classes are existing theme tokens so they flip across light/dark/matrix.
 */
export function toolIconColor(tool: string): string {
  const leaf = tool.replace(/^mcp__[^_]+__/, "");
  switch (leaf) {
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return "text-accent"; // file ops — indigo
    case "Bash":
      return "text-warn-fg"; // exec — amber
    case "WebFetch":
    case "WebSearch":
      return "text-ok-fg"; // web — green
    case "Task":
    case "crew_delegate":
    case "crew_ask_president":
    case "crew_report":
    case "crew_suggest":
      return "text-accent"; // crew tools — indigo
    default:
      if (leaf.startsWith("memory_")) return "text-accent"; // memory/brain — indigo
      return "text-fg-dim"; // search/glob/todo/skill/task/etc — neutral
  }
}

/** Semantic colour class for a lifecycle event's icon. Success-y lifecycle
 *  milestones go green; failures are handled by the error tone upstream. */
export function lifecycleIconColor(msg: string): string {
  switch (msg) {
    case "Turn complete":
    case "Bot is listening for updates":
    case "Management panel listening":
      return "text-ok-fg"; // CheckCircle2 / Rocket / MonitorCheck — green
    default:
      return "text-fg-dim";
  }
}

/** Map a known lifecycle log message to its Lucide icon, or null if not tracked. */
export function lifecycleIcon(msg: string): LucideIcon | null {
  switch (msg) {
    case "Prompt received":
      return MessageSquare;
    case "Voice transcribed":
      return Mic;
    case "File received":
      return Inbox;
    case "Photo received":
      return Image;
    case "Turn complete":
      return CheckCircle2;
    case "Scheduler started":
      return AlarmClock;
    case "Scheduled task firing":
      return Timer;
    case "Heartbeat started":
      return HeartPulse;
    case "Update check":
      return RefreshCw;
    case "Usage probe starting":
      return BarChart3;
    case "Maintenance run starting":
      return Sparkles;
    case "Bot is listening for updates":
      return Rocket;
    case "Management panel listening":
      return MonitorCheck;
    case "Council command failed":
    case "Worker run failed":
    case "Task delegation failed":
      return AlertTriangle;
    default:
      return null;
  }
}

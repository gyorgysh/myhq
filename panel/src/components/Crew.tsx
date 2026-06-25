import { useEffect, useState } from "react";
import { api, type Worker, type MainAgent } from "../api.ts";
import { Empty } from "./ui.tsx";

export function CrewView({ onAuthError }: { onAuthError: () => void }) {
  const [atlas, setAtlas] = useState<MainAgent | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.agent(), api.workers()])
      .then(([a, w]) => {
        setAtlas(a);
        setWorkers(w.workers);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface auth failures up the tree (parity with other views).
  useEffect(() => {
    if (error === "AuthError: unauthorized") onAuthError();
  }, [error, onAuthError]);

  if (error) return <Empty>Failed to load: {error}</Empty>;

  const leads = workers.filter((w) => w.role === "lead");
  const assistants = workers.filter((w) => w.role === "assistant");
  const specialists = workers.filter(
    (w) => !w.role || (w.role !== "lead" && w.role !== "assistant"),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">MyHQ Crew</h1>
        <p className="mt-1 text-sm text-fg-dim">Your personal AI command structure.</p>
      </div>

      {/* President */}
      <CrewNode
        icon="★"
        title="You"
        subtitle="President · sets direction, final say"
        tone="amber"
        depth={0}
      />

      {/* Atlas */}
      <CrewNode
        icon="◈"
        title="Atlas"
        subtitle={`Chief coordinator · ${atlas?.effectiveModel ?? "…"}`}
        tone="accent"
        depth={1}
      />

      {/* Leads and their Assistants */}
      {leads.map((lead) => (
        <div key={lead.id}>
          <CrewNode
            icon="◆"
            title={lead.name}
            subtitle={[lead.portfolio ? `${lead.portfolio} Lead` : "Lead", lead.model]
              .filter(Boolean)
              .join(" · ")}
            tone="blue"
            depth={2}
            extra={lead.telegramToken ? "has own bot" : undefined}
          />
          {assistants
            .filter((a) => a.parentId === lead.id)
            .map((a) => (
              <CrewNode
                key={a.id}
                icon="◇"
                title={a.name}
                subtitle={a.portfolio ?? "Assistant"}
                tone="zinc"
                depth={3}
              />
            ))}
        </div>
      ))}

      {/* Unparented assistants */}
      {assistants
        .filter((a) => !a.parentId || !leads.find((l) => l.id === a.parentId))
        .map((a) => (
          <CrewNode
            key={a.id}
            icon="◇"
            title={a.name}
            subtitle={a.portfolio ?? "Assistant"}
            tone="zinc"
            depth={2}
          />
        ))}

      {/* Specialists */}
      {specialists.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-fg-faint">
            Specialists
          </div>
          {specialists.map((w) => (
            <CrewNode
              key={w.id}
              icon="·"
              title={w.name}
              subtitle={w.model || "default model"}
              tone="zinc"
              depth={2}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type Tone = "amber" | "accent" | "blue" | "zinc";

function CrewNode({
  icon,
  title,
  subtitle,
  tone,
  depth,
  extra,
}: {
  icon: string;
  title: string;
  subtitle: string;
  tone: Tone;
  depth: number;
  extra?: string;
}) {
  const indent = depth * 24;
  const toneClass: Record<Tone, string> = {
    amber: "text-amber-400",
    accent: "text-[var(--accent)]",
    blue: "text-blue-400",
    zinc: "text-fg-dim",
  };

  return (
    <div className="flex items-center gap-3" style={{ paddingLeft: indent }}>
      {depth > 0 && (
        <div className="flex items-center">
          <div className="h-px w-4 bg-line" />
        </div>
      )}
      <div className={`shrink-0 w-5 text-center text-sm ${toneClass[tone]}`}>{icon}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg">{title}</span>
          {extra && <span className="text-xs text-fg-faint">{extra}</span>}
        </div>
        <div className="text-xs text-fg-dim">{subtitle}</div>
      </div>
    </div>
  );
}

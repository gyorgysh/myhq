import { useEffect, useState } from "react";
import { api, AuthError, type MainAgent } from "../api.ts";
import { Badge, Button, Card } from "./ui.tsx";
import { useI18n } from "../lib/useI18n.ts";
import type { Tab } from "./Sidebar.tsx";

type Me = Awaited<ReturnType<typeof api.me>>;

/**
 * A single top-level "Setup" view that walks a new operator through initial
 * configuration in a logical order — bot identity → access control → model →
 * panel access → remote access — and gives a returning user one place to find
 * every config knob without hunting through the nav.
 *
 * Several of these (bot token, allowed user IDs, panel token) live in `.env`
 * and are NOT editable from the panel by design (a panel-token holder must not
 * be able to widen the allow-list or rotate the bot from the browser). They are
 * shown here read-only with guidance. The editable bits (model, persona,
 * autonomy, providers, remote access) link out to their existing views so we
 * keep a single source of truth instead of duplicating the editors.
 */
export function SetupView({
  onAuthError,
  onGoto,
}: {
  onAuthError: () => void;
  onGoto: (t: Tab | "settings") => void;
}) {
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [agent, setAgent] = useState<MainAgent | null>(null);

  useEffect(() => {
    api.me().then(setMe).catch((e) => e instanceof AuthError && onAuthError());
    api
      .agent()
      .then(setAgent)
      .catch((e) => e instanceof AuthError && onAuthError());
  }, [onAuthError]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">{t("setup_title")}</h1>
        <p className="mt-1 text-sm text-fg-dim">{t("setup_desc")}</p>
      </div>

      {/* 1. Bot identity */}
      <SetupStep n={1} title={t("setup_identity")} desc={t("setup_identity_desc")}>
        <Fact label={t("setup_agent_name")} value={me?.atlasName || "Atlas"} />
        <Fact label={t("setup_brand_name")} value={me?.brandName || "MyHQ"} />
        <Fact
          label={t("setup_bot_username")}
          value={
            agent?.botUsername ? (
              <a
                href={`https://t.me/${agent.botUsername}`}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                @{agent.botUsername}
              </a>
            ) : (
              <span className="text-fg-faint">{t("setup_unknown")}</span>
            )
          }
        />
        <EnvNote text={t("setup_identity_env")} />
      </SetupStep>

      {/* 2. Access control */}
      <SetupStep n={2} title={t("setup_access")} desc={t("setup_access_desc")}>
        <Fact
          label={t("setup_allowed_users")}
          value={
            me ? (
              <Badge tone={me.allowedUserCount > 0 ? "green" : "amber"}>
                {me.allowedUserCount}
              </Badge>
            ) : (
              "…"
            )
          }
        />
        <EnvNote text={t("setup_access_env")} />
      </SetupStep>

      {/* 3. Model */}
      <SetupStep n={3} title={t("setup_model")} desc={t("setup_model_desc")}>
        <Fact
          label={t("setup_active_model")}
          value={
            agent ? (
              <Badge tone="blue">{agent.effectiveModel}</Badge>
            ) : (
              "…"
            )
          }
        />
        <Fact
          label={t("setup_provider")}
          value={agent?.providerName || t("settings_anthropic_default")}
        />
        <div className="pt-1">
          <Button onClick={() => onGoto("settings")}>{t("setup_open_settings")}</Button>
        </div>
      </SetupStep>

      {/* 4. Panel access */}
      <SetupStep n={4} title={t("setup_panel")} desc={t("setup_panel_desc")}>
        <Fact
          label={t("setup_panel_bind")}
          value={me ? `${me.panelHost}:${me.panelPort}` : "…"}
        />
        <Fact
          label={t("setup_terminal")}
          value={
            me ? (
              <Badge tone={me.terminalEnabled ? "green" : "zinc"}>
                {me.terminalEnabled ? t("setup_enabled") : t("setup_disabled")}
              </Badge>
            ) : (
              "…"
            )
          }
        />
        <EnvNote text={t("setup_panel_env")} />
      </SetupStep>

      {/* 5. Remote access */}
      <SetupStep n={5} title={t("setup_remote")} desc={t("setup_remote_desc")}>
        <Fact
          label={t("setup_remote_status")}
          value={
            me ? (
              <Badge tone={me.tunnelEnabled ? "green" : "zinc"}>
                {me.tunnelEnabled ? t("setup_enabled") : t("setup_disabled")}
              </Badge>
            ) : (
              "…"
            )
          }
        />
        {me?.tunnelEnabled ? (
          <div className="pt-1">
            <Button onClick={() => onGoto("remote")}>{t("setup_open_remote")}</Button>
          </div>
        ) : (
          <EnvNote text={t("setup_remote_env")} />
        )}
      </SetupStep>
    </div>
  );
}

/** A numbered configuration step card. */
function SetupStep({
  n,
  title,
  desc,
  children,
}: {
  n: number;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2 normal-case">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
            {n}
          </span>
          {title}
        </span>
      }
    >
      <p className="mb-3 text-sm text-fg-dim">{desc}</p>
      <div className="space-y-2">{children}</div>
    </Card>
  );
}

/** A labelled read-only fact row. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-fg-dim">{label}</span>
      <span className="text-fg">{value}</span>
    </div>
  );
}

/** A muted note explaining a setting is .env-sourced and not panel-editable. */
function EnvNote({ text }: { text: string }) {
  return (
    <p className="mt-2 border-t border-line pt-2 text-xs text-fg-faint">{text}</p>
  );
}

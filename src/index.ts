import { config, allowedUserIds } from "./config.js";
import { buildBot } from "./bot.js";
import { log } from "./logger.js";

async function main(): Promise<void> {
  if (config.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = config.ANTHROPIC_API_KEY;
  }

  const bot = buildBot();

  const me = await bot.telegram.getMe();
  log.info("Configuration loaded", {
    bot: `@${me.username}`,
    allowedUsers: allowedUserIds.size,
    workdir: config.WORKDIR,
    model: config.CLAUDE_MODEL,
    streamMode: config.STREAM_MODE,
    auth: config.ANTHROPIC_API_KEY ? "api-key" : "cli-login",
  });

  await bot.telegram.setMyCommands([
    { command: "new", description: "Start a fresh conversation" },
    { command: "cd", description: "Change working directory" },
    { command: "pwd", description: "Show current directory" },
    { command: "status", description: "Show session info" },
    { command: "stop", description: "Abort the running request" },
    { command: "mode", description: "safe (approval) or auto" },
    { command: "help", description: "Show help" },
  ]);

  process.once("SIGINT", () => {
    log.info("SIGINT — shutting down");
    bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    log.info("SIGTERM — shutting down");
    bot.stop("SIGTERM");
  });

  log.info("Bot starting (long polling)…");
  // launch() resolves only once polling stops; log just before it begins.
  void bot
    .launch(() => log.info("Bot is listening for updates"))
    .catch((err) => {
      log.error("Polling stopped", { error: errText(err) });
      process.exit(1);
    });
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err) => {
  log.error("Fatal during startup", { error: errText(err) });
  process.exit(1);
});

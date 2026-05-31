import { PROVIDER_PRESETS, listProviders, type ProviderPreset } from "@larb/providers";

/**
 * List the built-in provider presets and whether each one's API key is set in
 * the environment. Read-only and offline: it inspects config + env only and
 * makes no network call. Pass a provider name to see its full details.
 */
export function providersCommand(args: string[]): void {
  const filter = args.find((a) => !a.startsWith("-"));

  const presets: Record<string, ProviderPreset> = PROVIDER_PRESETS;

  if (filter) {
    const preset = presets[filter];
    if (!preset) {
      console.error(
        `Unknown provider "${filter}". Known: ${listProviders().join(", ")}`,
      );
      process.exitCode = 1;
      return;
    }
    printDetail(filter, preset);
    return;
  }

  console.log("Available providers (set `kind` in ~/.larb/config.toml):\n");
  for (const kind of listProviders()) {
    const preset = presets[kind]!;
    const env = preset.apiKeyEnv;
    const status = !env
      ? "local — no key"
      : process.env[env]
        ? `${env} ✓ set`
        : `${env} (not set)`;
    console.log(`  ${kind.padEnd(12)} ${preset.label.padEnd(16)} ${status}`);
  }
  console.log("\nRun `larb providers <name>` for default models and base URL.");
}

function printDetail(kind: string, preset: ProviderPreset): void {
  const env = preset.apiKeyEnv;
  console.log(`${preset.label} (kind = "${kind}")\n`);
  console.log(`  transport:    ${preset.transport}`);
  console.log(`  base URL:     ${preset.baseURL ?? "(adapter default)"}`);
  if (!env) {
    console.log(`  API key:      none required (local)`);
  } else {
    console.log(`  API key env:  ${env} ${process.env[env] ? "✓ set" : "(not set)"}`);
  }
  console.log(`  orchestrator: ${preset.models.orchestrator}`);
  console.log(`  worker:       ${preset.models.worker ?? preset.models.orchestrator}`);
  console.log("");
  console.log("Config example:");
  console.log("  [provider]");
  console.log(`  kind = "${kind}"`);
  if (env) console.log(`  # export ${env}=...`);
}

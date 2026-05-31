import { z } from "zod";

/**
 * The skill manifest is the enforced contract. A skill may use exactly the
 * capabilities it declares here — nothing more. Larb enforces this at the
 * capability broker regardless of what the skill's code attempts.
 */
export const ToolDefSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_]+$/),
  description: z.string(),
  inputSchema: z.record(z.unknown()).default({ type: "object" }),
});

export const CapabilitiesSchema = z
  .object({
    /** Project-relative path prefixes the skill may read / write. */
    fs: z
      .object({
        read: z.array(z.string()).optional(),
        write: z.array(z.string()).optional(),
      })
      .optional(),
    /** Network hosts the skill may contact. */
    net: z.array(z.string()).optional(),
    /** Whether the skill may run shell commands (always sandboxed). */
    exec: z.boolean().optional(),
    /** Whether the skill needs brokered secret access (reserved). */
    secret: z.boolean().optional(),
  })
  .default({});

export const ManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase kebab-case"),
  version: z.string(),
  description: z.string(),
  /** Model-readable instructions injected into context (or read from SKILL.md). */
  instructions: z.string().optional(),
  /** Optional code plugin providing executable tools. */
  plugin: z
    .object({
      entry: z.string(),
      tools: z.array(ToolDefSchema).default([]),
    })
    .optional(),
  capabilities: CapabilitiesSchema,
});

export type SkillManifest = z.infer<typeof ManifestSchema>;
export type SkillToolDef = z.infer<typeof ToolDefSchema>;

export function parseManifest(raw: unknown): SkillManifest {
  return ManifestSchema.parse(raw);
}

/** A path prefix declaration matches a relative path. `*`/`**` mean "any". */
export function pathDeclared(declared: string[] | undefined, rel: string): boolean {
  if (!declared) return false;
  return declared.some((d) => {
    if (d === "*" || d === "**") return true;
    if (rel === d) return true;
    const prefix = d.endsWith("/") ? d : d + "/";
    return rel.startsWith(prefix);
  });
}

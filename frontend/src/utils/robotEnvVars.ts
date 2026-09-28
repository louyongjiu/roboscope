/**
 * Story FE-ENV — Robot Framework environment-variable references `%{NAME}`
 * and `%{NAME=default}` (read from the OS environment, distinct from suite
 * `${}` variables). Pure helpers for recognising + summarising them.
 */

export interface EnvVarRef {
  name: string
  /** Inline default (`%{NAME=default}`) or null when none is given. */
  default: string | null
}

// Global, so `exec` walks all matches. Reset lastIndex before each use.
const ENV_REF_RE = /%\{([^}=]+)(?:=([^}]*))?\}/g

/** Extract every `%{…}` reference from a single string, in order. */
export function extractEnvVarRefs(text: string): EnvVarRef[] {
  const out: EnvVarRef[] = []
  if (!text) return out
  ENV_REF_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ENV_REF_RE.exec(text)) !== null) {
    out.push({ name: m[1].trim(), default: m[2] !== undefined ? m[2] : null })
  }
  return out
}

/** Distinct `%{…}` refs across many strings, de-duped by name. The first
 *  occurrence's default wins (so a later bare ref doesn't drop a default). */
export function collectEnvVarRefs(texts: string[]): EnvVarRef[] {
  const byName = new Map<string, EnvVarRef>()
  for (const t of texts) {
    for (const ref of extractEnvVarRefs(t)) {
      const existing = byName.get(ref.name)
      if (!existing) byName.set(ref.name, ref)
      else if (existing.default === null && ref.default !== null) {
        byName.set(ref.name, ref)
      }
    }
  }
  return [...byName.values()]
}

export type EnvRefState = 'defined' | 'default' | 'missing' | 'unknown'

/** Story V15.2 — classify refs against the environment's defined variable
 *  KEYS (never values). `null` keys = nothing resolvable → all `unknown`. */
// ponytail: exact-case compare; relax if Windows-hosted teams report false warnings
export function classifyEnvRefs(
  refs: EnvVarRef[],
  definedKeys: Set<string> | null,
): { ref: EnvVarRef; state: EnvRefState }[] {
  return refs.map((ref) => ({
    ref,
    state: definedKeys === null ? 'unknown'
      : definedKeys.has(ref.name) ? 'defined'
      : ref.default !== null ? 'default'
      : 'missing',
  }))
}

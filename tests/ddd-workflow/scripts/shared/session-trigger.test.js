import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const SOURCE = readFileSync(new URL("../../../../src/ddd-workflow/scripts/shared/session-trigger.mjs", import.meta.url), "utf8")

describe("session-trigger", () => {
  it("keeps the Codex command on the model bucket used by interactive Codex and opencode", () => {
    expect(SOURCE).toContain('"-m", "gpt-5.5"')
    expect(SOURCE).toContain('"--model", "openai/gpt-5.5"')
  })

  it("keeps the Codex trigger disabled by default", () => {
    expect(SOURCE).toContain("const ENABLE_CODEX_TRIGGER = false")
    expect(SOURCE).toContain("...(ENABLE_CODEX_TRIGGER ? [{")
  })

  it("includes opencode in the keepalive agents", () => {
    expect(SOURCE).toContain('name: "opencode"')
    expect(SOURCE).toContain('"opencode", "run"')
    expect(SOURCE).toContain("parseOpencodeResult")
  })

  it("keeps the opencode trigger prompt small", () => {
    expect(SOURCE).toContain('OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "1"')
    expect(SOURCE).toContain('OPENCODE_DISABLE_EXTERNAL_SKILLS: "1"')
    expect(SOURCE).toContain('OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1"')
  })
})

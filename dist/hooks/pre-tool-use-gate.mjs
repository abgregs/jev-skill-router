#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// hooks/pre-tool-use-gate.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
var STATE_DIR = join(tmpdir(), "jev-skill-router");
var STATE_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
function allow() {
  process.exit(0);
}
function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    })
  );
  process.exit(0);
}
function alwaysAllowList(projectCwd) {
  for (const p of [join(projectCwd, ".skillrouter.json"), join(homedir(), ".skillrouter.json")]) {
    if (!existsSync(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(cfg.alwaysAllow)) return cfg.alwaysAllow.filter((x) => typeof x === "string");
    } catch {
    }
    break;
  }
  return [];
}
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (input.tool_name !== "Skill") allow();
  const skill = input.tool_input?.skill ?? "";
  if (!skill) allow();
  const statePath = join(STATE_DIR, `turn-${input.session_id ?? "unknown"}.json`);
  if (!existsSync(statePath)) allow();
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (Date.now() - state.ts > STATE_MAX_AGE_MS) allow();
  const approved = /* @__PURE__ */ new Set([...state.invoke, ...state.suggest, ...alwaysAllowList(input.cwd ?? process.cwd())]);
  const prompt = state.prompt.toLowerCase();
  const baseName = skill.split(":").pop() ?? skill;
  if (prompt.includes(skill.toLowerCase()) || prompt.includes(baseName.toLowerCase())) allow();
  if (approved.has(skill)) allow();
  deny(
    `Skill routing gate: "${skill}" is not on this turn's approved list. Invoke: [${state.invoke.join(", ") || "none"}]. Suggested: [${state.suggest.join(", ") || "none"}]. Use an approved skill, or ask the user if you believe this skill is needed.`
  );
} catch {
  allow();
}

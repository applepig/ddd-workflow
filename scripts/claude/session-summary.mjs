#!/usr/bin/env node
// Stop hook：長輪次結束時輸出結束時刻、session 累計 token 用量與 quota 剩餘，
// 補上內建 "Sautéed for 4m 18s" 缺的絕對時間。
// 走 exit 0 + systemMessage，不進 model context。
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const QUOTA_CACHE = process.env.STATUSLINE_CACHE_FILE ?? "/tmp/claude/statusline-usage-cache.json";
const MIN_TURN_MINUTES = Number(process.env.SESSION_SUMMARY_MIN_TURN_MINUTES ?? 20);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const EMPTY_SCAN = { turn_started_at: null, input: 0, output: 0, cache_read: 0, cache_write: 0 };

// transcript 逐行掃：本輪起點取 promptId 匹配的第一筆 timestamp——
// Claude Code 的 "Sautéed for Xm Ys" 就是 (turn 結束時刻 − 該時間戳)，實測誤差 <50ms。
// usage 依 message.id 去重加總（同一則 assistant 在 transcript 會重複出現），統計整個 session。
// 讀不到就退回只印時間——hook 失敗不該在畫面上跳 error notice。
async function scanTranscript(transcript_path, prompt_id) {
  if (typeof transcript_path !== "string" || transcript_path === "") return EMPTY_SCAN;
  const stream = (await import("node:fs")).createReadStream(transcript_path, "utf8");
  stream.on("error", () => {});
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const seen = new Set();
  let turn_started_at = null;
  let input = 0, output = 0, cache_read = 0, cache_write = 0;

  for await (const line of lines) {
    if (line === "") continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (turn_started_at === null && record.promptId === prompt_id && typeof record.timestamp === "string") {
      const ms = Date.parse(record.timestamp);
      if (Number.isFinite(ms)) turn_started_at = ms;
    }
    const usage = record?.message?.usage;
    if (!usage) continue;
    const id = record.message.id ?? record.uuid;
    if (id !== undefined) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    input += usage.input_tokens ?? 0;
    output += usage.output_tokens ?? 0;
    cache_read += usage.cache_read_input_tokens ?? 0;
    cache_write += usage.cache_creation_input_tokens ?? 0;
  }
  return { turn_started_at, input, output, cache_read, cache_write };
}

async function readQuota() {
  try {
    return JSON.parse(await readFile(QUOTA_CACHE, "utf8"));
  } catch {
    return null;
  }
}

function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString("zh-TW", {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDuration(ms) {
  const total_sec = Math.round(ms / 1000);
  const sec = total_sec % 60;
  const min = Math.floor(total_sec / 60) % 60;
  const hour = Math.floor(total_sec / 3600);
  if (hour > 0) return `${hour}h ${min}m ${sec}s`;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

function fmtResetAt(resets_at) {
  const ms = Date.parse(resets_at ?? "");
  if (!Number.isFinite(ms)) return null;
  const mins = Math.round((ms - Date.now()) / 60000);
  if (mins <= 0) return "已重置";
  if (mins < 60) return `${mins}m 後重置`;
  return `${Math.floor(mins / 60)}h${mins % 60}m 後重置`;
}

function quotaText(label, window) {
  if (!window || typeof window.utilization !== "number") return null;
  const reset = fmtResetAt(window.resets_at);
  return `${label} ${Math.round(window.utilization)}%${reset === null ? "" : `（${reset}）`}`;
}

let payload = {};
try { payload = JSON.parse(await readStdin()); } catch {}

let scan = EMPTY_SCAN;
try { scan = await scanTranscript(payload.transcript_path, payload.prompt_id); } catch {}
const { turn_started_at, input, output, cache_read, cache_write } = scan;

const now = Date.now();
const turn_ms = turn_started_at === null ? null : now - turn_started_at;
if (turn_ms !== null && turn_ms < MIN_TURN_MINUTES * 60000) process.exit(0);

const quota = await readQuota();
const quota_parts = [quotaText("5h", quota?.five_hour), quotaText("7d", quota?.seven_day)]
  .filter((part) => part !== null);
const lines = [
  `⏱ stopped at ${fmtClock(now)}${turn_ms === null ? "" : `（本輪 ${fmtDuration(turn_ms)}）`}`,
  `🔢 session 累計 in ${fmtTokens(input)} / out ${fmtTokens(output)} / cache r${fmtTokens(cache_read)} w${fmtTokens(cache_write)}`,
  quota_parts.length === 0 ? null : `📊 ${quota_parts.join("　")}`,
].filter((line) => line !== null);

// exit 0 + systemMessage：顯示給使用者，不會進入 model context。
process.stdout.write(JSON.stringify({ systemMessage: lines.join("\n") }));

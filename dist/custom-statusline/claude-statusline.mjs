#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
//#region .publish/ddd-workflow/scripts/custom-statusline/core/quota-window.ts
var STATUSLINE_WINDOW_LABEL_OVERRIDES = {
	300: "Session",
	10080: "Weekly"
};
var MINUTES_PER_WEEK = 10080;
var MINUTES_PER_DAY$1 = 1440;
var MINUTES_PER_HOUR = 60;
function resolveWindowKind(window_minutes) {
	if (typeof window_minutes !== "number" || !Number.isFinite(window_minutes) || window_minutes <= 0) return null;
	if (window_minutes % MINUTES_PER_WEEK === 0) return {
		unit: "week",
		count: window_minutes / MINUTES_PER_WEEK
	};
	if (window_minutes % MINUTES_PER_DAY$1 === 0) return {
		unit: "day",
		count: window_minutes / MINUTES_PER_DAY$1
	};
	if (window_minutes % MINUTES_PER_HOUR === 0) return {
		unit: "hour",
		count: window_minutes / MINUTES_PER_HOUR
	};
	return {
		unit: "minute",
		count: window_minutes
	};
}
function genericWindowLabel(kind) {
	switch (kind.unit) {
		case "week": return kind.count === 1 ? "week" : `${kind.count}wk`;
		case "day": return `${kind.count}d`;
		case "hour": return `${kind.count}hr`;
		case "minute": return `${kind.count}m`;
	}
}
function windowLabel(window_minutes, overrides = {}) {
	const kind = resolveWindowKind(window_minutes);
	if (kind === null) return null;
	return overrides[window_minutes] ?? genericWindowLabel(kind);
}
function isValidResetAt(reset_at) {
	return typeof reset_at === "number" && Number.isFinite(reset_at) && reset_at > 0;
}
function isWindowElapsed(reset_at, now_ms) {
	return reset_at <= Math.floor(now_ms / 1e3);
}
function isWindowActive(window, now_ms) {
	if (!window) return false;
	if (!isValidResetAt(window.reset_at)) return false;
	return !isWindowElapsed(window.reset_at, now_ms);
}
function isObservedAtPlausible(observed_at, now_ms) {
	if (typeof observed_at !== "string") return false;
	const observed_ms = Date.parse(observed_at);
	if (!Number.isFinite(observed_ms)) return false;
	return observed_ms - now_ms <= 300 * 1e3;
}
function isObservationFresh(observed_at, now_ms, max_age_seconds) {
	if (!isObservedAtPlausible(observed_at, now_ms)) return false;
	return now_ms - Date.parse(observed_at) <= max_age_seconds * 1e3;
}
function isValidUsedPercent(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}
//#endregion
//#region .publish/ddd-workflow/scripts/custom-statusline/collectors/anthropic-oauth-usage.ts
var ANTHROPIC_USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";
var ANTHROPIC_USAGE_FETCH_TIMEOUT_MS = 5e3;
function envValue$1(env, key) {
	const value = env[key];
	return typeof value === "string" && value !== "" ? value : null;
}
function resolveAnthropicCacheFilePath(env = process.env) {
	return envValue$1(env, "STATUSLINE_CACHE_FILE") ?? "/tmp/claude/statusline-usage-cache.json";
}
function resolveAnthropicThrottleFilePath(env = process.env) {
	return path.join(path.dirname(resolveAnthropicCacheFilePath(env)), "statusline-usage.throttle");
}
function resolveAnthropicCredentialsFilePath(env = process.env) {
	return envValue$1(env, "STATUSLINE_CREDENTIALS_FILE") ?? path.join(homedir(), ".claude", ".credentials.json");
}
async function getOAuthToken(options = {}) {
	const env = options.env ?? process.env;
	const env_token = envValue$1(env, "CLAUDE_CODE_OAUTH_TOKEN");
	if (env_token !== null) return env_token;
	let raw;
	try {
		raw = await readFile(resolveAnthropicCredentialsFilePath(env), "utf8");
	} catch {
		return null;
	}
	try {
		const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
		return typeof token === "string" && token !== "" ? token : null;
	} catch {
		return null;
	}
}
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isResetAtOk(value) {
	return value === null || value === void 0 || typeof value === "string" || typeof value === "number";
}
function isWindowOk(value) {
	if (!isRecord$2(value)) return false;
	return isValidUsedPercent(value.utilization) && isResetAtOk(value.resets_at);
}
function isUsageResponseValid(value) {
	if (!isRecord$2(value)) return false;
	if (!isWindowOk(value.five_hour)) return false;
	const { seven_day, extra_usage } = value;
	if (seven_day !== null && seven_day !== void 0 && !isWindowOk(seven_day)) return false;
	if (extra_usage !== null && extra_usage !== void 0 && !isRecord$2(extra_usage)) return false;
	return true;
}
async function fileAgeSeconds$1(file_path, now_ms) {
	let file_stat;
	try {
		file_stat = await stat(file_path);
	} catch {
		return null;
	}
	return Math.floor(now_ms / 1e3) - Math.floor(file_stat.mtimeMs / 1e3);
}
async function writeFileWithMtime(file_path, content, now_ms) {
	await writeFile(file_path, content);
	const mtime = new Date(now_ms);
	await utimes(file_path, mtime, mtime);
}
async function bestEffort(action) {
	try {
		await action();
	} catch {}
}
async function readUsableUsageCache(max_age_seconds, options = {}) {
	const env = options.env ?? process.env;
	const now_ms = options.now_ms ?? Date.now();
	const cache_path = resolveAnthropicCacheFilePath(env);
	const age = await fileAgeSeconds$1(cache_path, now_ms);
	if (age === null || age >= max_age_seconds) return null;
	let raw;
	try {
		raw = await readFile(cache_path, "utf8");
	} catch {
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return isUsageResponseValid(parsed) ? parsed : null;
}
async function fetchAnthropicUsage(token, options = {}) {
	if (token === null || token === "") return null;
	const env = options.env ?? process.env;
	const now_ms = options.now_ms ?? Date.now();
	const fetch_fn = options.fetch_fn ?? fetch;
	const cache_path = resolveAnthropicCacheFilePath(env);
	const throttle_path = resolveAnthropicThrottleFilePath(env);
	await bestEffort(() => mkdir(path.dirname(cache_path), { recursive: true }));
	const throttle_age = await fileAgeSeconds$1(throttle_path, now_ms);
	if (throttle_age !== null && throttle_age < 60) return readUsableUsageCache(300, options);
	await bestEffort(() => writeFileWithMtime(throttle_path, "", now_ms));
	let body = null;
	try {
		body = await (await fetch_fn(ANTHROPIC_USAGE_API_URL, {
			headers: {
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20"
			},
			signal: AbortSignal.timeout(ANTHROPIC_USAGE_FETCH_TIMEOUT_MS)
		})).text();
	} catch {
		body = null;
	}
	if (body !== null && body !== "") {
		let parsed = null;
		try {
			parsed = JSON.parse(body);
		} catch {
			parsed = null;
		}
		if (parsed !== null && isUsageResponseValid(parsed)) {
			await bestEffort(() => writeFileWithMtime(cache_path, body, now_ms));
			return parsed;
		}
	}
	return readUsableUsageCache(300, options);
}
function safeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function safeResetsAt(value) {
	if (typeof value === "string" && value !== "") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return null;
}
function parseUsageResponse(response) {
	const five_hour = response?.five_hour ?? null;
	const seven_day = response?.seven_day ?? null;
	const extra_usage = response?.extra_usage ?? null;
	return {
		five_hour: {
			utilization: safeNumber(five_hour?.utilization),
			resets_at: safeResetsAt(five_hour?.resets_at)
		},
		seven_day: {
			utilization: safeNumber(seven_day?.utilization),
			resets_at: safeResetsAt(seven_day?.resets_at)
		},
		extra: {
			is_enabled: extra_usage?.is_enabled === true,
			utilization: safeNumber(extra_usage?.utilization),
			used_credits: safeNumber(extra_usage?.used_credits),
			monthly_limit: safeNumber(extra_usage?.monthly_limit)
		}
	};
}
async function readLastResortUsageCache(options = {}) {
	return readUsableUsageCache(Number.POSITIVE_INFINITY, options);
}
async function collectAnthropicOauthUsage(options = {}) {
	const token = await getOAuthToken(options);
	const response = await fetchAnthropicUsage(token, options);
	if (response !== null) return {
		...parseUsageResponse(response),
		is_stale: false
	};
	if (token === null || token === "") return {
		...parseUsageResponse(null),
		is_stale: false
	};
	const stale = await readLastResortUsageCache(options);
	if (stale === null) return {
		...parseUsageResponse(null),
		is_stale: false
	};
	return {
		...parseUsageResponse(stale),
		is_stale: true
	};
}
//#endregion
//#region .publish/ddd-workflow/scripts/custom-statusline/collectors/claude-status-json.ts
var EMPTY_STATUS_JSON = {
	model: null,
	effort_level: null,
	context_window: null,
	rate_limits: null,
	cwd: null,
	project_dir: null,
	session_id: null
};
function asRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value;
}
function asString(value) {
	return typeof value === "string" ? value : null;
}
function asFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function parseModel(model) {
	if (typeof model === "string") return {
		id: model,
		display_name: null
	};
	const record = asRecord(model);
	if (record === null) return null;
	return {
		id: asString(record.id),
		display_name: asString(record.display_name)
	};
}
function parseCurrentUsage(current_usage) {
	const legacy_total = asFiniteNumber(current_usage);
	if (legacy_total !== null) return legacy_total;
	const record = asRecord(current_usage);
	if (record === null) return null;
	return {
		input_tokens: asFiniteNumber(record.input_tokens),
		output_tokens: asFiniteNumber(record.output_tokens),
		cache_creation_input_tokens: asFiniteNumber(record.cache_creation_input_tokens),
		cache_read_input_tokens: asFiniteNumber(record.cache_read_input_tokens)
	};
}
function parseContextWindow(context_window) {
	const record = asRecord(context_window);
	if (record === null) return null;
	return {
		total_input_tokens: asFiniteNumber(record.total_input_tokens),
		total_output_tokens: asFiniteNumber(record.total_output_tokens),
		context_window_size: asFiniteNumber(record.context_window_size),
		current_usage: parseCurrentUsage(record.current_usage),
		used_percentage: asFiniteNumber(record.used_percentage),
		remaining_percentage: asFiniteNumber(record.remaining_percentage)
	};
}
function parseClaudeStatusJson(input) {
	let payload;
	try {
		payload = JSON.parse(input);
	} catch {
		return { ...EMPTY_STATUS_JSON };
	}
	const record = asRecord(payload);
	if (record === null) return { ...EMPTY_STATUS_JSON };
	const cwd = asString(record.cwd);
	const workspace = asRecord(record.workspace);
	const effort = asRecord(record.effort);
	return {
		model: parseModel(record.model),
		effort_level: effort === null ? null : asString(effort.level),
		context_window: parseContextWindow(record.context_window),
		rate_limits: asRecord(record.rate_limits),
		cwd,
		project_dir: (workspace === null ? null : asString(workspace.project_dir)) ?? cwd,
		session_id: asString(record.session_id)
	};
}
function resolveCodexAuthFilePath() {
	return path.join(homedir(), ".codex", "auth.json");
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readCodexAuth(auth_file_path) {
	let raw;
	try {
		raw = await readFile(auth_file_path, "utf8");
	} catch {
		return {
			ok: false,
			reason: "auth_unavailable"
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			ok: false,
			reason: "auth_malformed"
		};
	}
	if (!isRecord$1(parsed) || !isRecord$1(parsed.tokens)) return {
		ok: false,
		reason: "auth_incomplete"
	};
	const { access_token, account_id } = parsed.tokens;
	if (typeof access_token !== "string" || access_token === "") return {
		ok: false,
		reason: "auth_incomplete"
	};
	if (typeof account_id !== "string" || account_id === "") return {
		ok: false,
		reason: "auth_incomplete"
	};
	return {
		ok: true,
		access_token,
		account_id
	};
}
function isPositiveFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function normalizeWindow(value) {
	if (!isRecord$1(value)) return null;
	const used_percent = isValidUsedPercent(value.used_percent) ? value.used_percent : null;
	const reset_at = isPositiveFiniteNumber(value.reset_at) ? value.reset_at : null;
	const window_minutes = isPositiveFiniteNumber(value.limit_window_seconds) ? value.limit_window_seconds / 60 : null;
	return used_percent !== null || reset_at !== null || window_minutes !== null ? {
		used_percent,
		reset_at,
		window_minutes
	} : null;
}
function normalizeCredits(value) {
	if (!isRecord$1(value)) return null;
	const has_credits = typeof value.has_credits === "boolean" ? value.has_credits : null;
	const unlimited = typeof value.unlimited === "boolean" ? value.unlimited : null;
	return has_credits !== null || unlimited !== null ? {
		has_credits,
		unlimited
	} : null;
}
function normalizeUsageResponse(body, now_ms) {
	if (!isRecord$1(body) || !isRecord$1(body.rate_limit)) return {
		ok: false,
		reason: "invalid_response"
	};
	const primary = normalizeWindow(body.rate_limit.primary_window);
	const secondary = normalizeWindow(body.rate_limit.secondary_window);
	if (primary === null && secondary === null) return {
		ok: false,
		reason: "invalid_response"
	};
	return {
		ok: true,
		observation: {
			schema_version: 2,
			provider: "openai",
			source: "codex-usage-api",
			observed_at: new Date(now_ms).toISOString(),
			plan_type: typeof body.plan_type === "string" ? body.plan_type : null,
			active_limit: null,
			credits: normalizeCredits(body.credits),
			primary,
			secondary
		}
	};
}
async function fetchCodexUsage(options = {}) {
	const auth = await readCodexAuth(options.auth_file_path ?? resolveCodexAuthFilePath());
	if (!auth.ok) return auth;
	const fetch_fn = options.fetch_fn ?? globalThis.fetch;
	const base_url = options.base_url ?? "https://chatgpt.com/backend-api";
	const timeout_ms = options.timeout_ms ?? 5e3;
	let response;
	try {
		response = await fetch_fn(`${base_url}/wham/usage`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${auth.access_token}`,
				"chatgpt-account-id": auth.account_id
			},
			signal: AbortSignal.timeout(timeout_ms)
		});
	} catch {
		return {
			ok: false,
			reason: "network_error"
		};
	}
	if (response.status === 401) return {
		ok: false,
		reason: "unauthorized"
	};
	if (!response.ok) return {
		ok: false,
		reason: "http_error"
	};
	let body;
	try {
		body = await response.json();
	} catch {
		return {
			ok: false,
			reason: "invalid_response"
		};
	}
	return normalizeUsageResponse(body, options.now_ms ?? Date.now());
}
//#endregion
//#region .publish/ddd-workflow/scripts/custom-statusline/core/codex-usage-store.ts
var DEFAULT_MAX_AGE_SECONDS = 3600;
var DEFAULT_LOCK_TIMEOUT_MS = 2e3;
var DEFAULT_LOCK_STALE_MS = 1e4;
var LOCK_RETRY_INTERVAL_MS = 15;
var VALID_SOURCES = ["codex-usage-api", "opencode-capture"];
function envValue(env, key) {
	const value = env[key];
	return typeof value === "string" && value !== "" ? value : null;
}
function resolveCodexUsageFilePath(env = process.env) {
	const override = envValue(env, "DDD_CODEX_USAGE_FILE");
	if (override !== null) return override;
	const cache_home = envValue(env, "XDG_CACHE_HOME") ?? path.join(homedir(), ".cache");
	return path.join(cache_home, "ddd-workflow", "custom-statusline", "codex-usage.json");
}
function resolveMaxAgeSeconds(env = process.env) {
	const override = envValue(env, "DDD_CODEX_USAGE_MAX_AGE_SECONDS");
	if (override === null) return DEFAULT_MAX_AGE_SECONDS;
	const parsed = Number(override);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_AGE_SECONDS;
	return parsed;
}
function isIsoTimestamp(value) {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateNullableString(value) {
	if (value === null || value === void 0) return null;
	return typeof value === "string" ? value : void 0;
}
function validateNullableBoolean(value) {
	if (value === null || value === void 0) return null;
	return typeof value === "boolean" ? value : void 0;
}
function validateWindow(value) {
	if (value === null || value === void 0) return null;
	if (!isRecord(value)) return void 0;
	const { used_percent, reset_at, window_minutes } = value;
	if (used_percent !== null && used_percent !== void 0 && !isValidUsedPercent(used_percent)) return void 0;
	if (reset_at !== null && reset_at !== void 0) {
		if (typeof reset_at !== "number" || !Number.isFinite(reset_at) || reset_at <= 0) return void 0;
	}
	if (window_minutes !== null && window_minutes !== void 0) {
		if (typeof window_minutes !== "number" || !Number.isFinite(window_minutes) || window_minutes <= 0) return void 0;
	}
	return {
		used_percent: used_percent ?? null,
		reset_at: reset_at ?? null,
		window_minutes: window_minutes ?? null
	};
}
function validateCredits(value) {
	if (value === null || value === void 0) return null;
	if (!isRecord(value)) return void 0;
	const has_credits = validateNullableBoolean(value.has_credits);
	const unlimited = validateNullableBoolean(value.unlimited);
	if (has_credits === void 0 || unlimited === void 0) return void 0;
	return {
		has_credits,
		unlimited
	};
}
function validateCodexUsageSnapshot(value) {
	if (!isRecord(value)) return null;
	if (value.schema_version !== 2) return null;
	if (value.provider !== "openai") return null;
	if (!VALID_SOURCES.includes(value.source)) return null;
	if (!isIsoTimestamp(value.observed_at)) return null;
	if (!isIsoTimestamp(value.updated_at)) return null;
	const plan_type = validateNullableString(value.plan_type);
	const active_limit = validateNullableString(value.active_limit);
	const credits = validateCredits(value.credits);
	const primary = validateWindow(value.primary);
	const secondary = validateWindow(value.secondary);
	if (plan_type === void 0 || active_limit === void 0 || credits === void 0 || primary === void 0 || secondary === void 0) return null;
	return {
		schema_version: 2,
		provider: "openai",
		source: value.source,
		observed_at: value.observed_at,
		updated_at: value.updated_at,
		plan_type,
		active_limit,
		credits,
		primary,
		secondary
	};
}
async function readSnapshotFromFile(file_path, now_ms) {
	let raw;
	try {
		raw = await readFile(file_path, "utf8");
	} catch {
		return null;
	}
	let snapshot;
	try {
		snapshot = validateCodexUsageSnapshot(JSON.parse(raw));
	} catch {
		return null;
	}
	if (snapshot === null) return null;
	return isObservedAtPlausible(snapshot.observed_at, now_ms) ? snapshot : null;
}
async function readCodexUsageRaw(options = {}) {
	return readSnapshotFromFile(resolveCodexUsageFilePath(options.env ?? process.env), options.now_ms ?? Date.now());
}
async function readCodexUsageFresh(options = {}) {
	const env = options.env ?? process.env;
	const snapshot = await readCodexUsageRaw(options);
	if (snapshot === null) return null;
	const now_ms = options.now_ms ?? Date.now();
	return isObservationFresh(snapshot.observed_at, now_ms, resolveMaxAgeSeconds(env)) ? snapshot : null;
}
function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
async function acquireLock(lock_path, timeout_ms, stale_ms) {
	const deadline_ms = Date.now() + timeout_ms;
	for (;;) {
		try {
			const handle = await open(lock_path, "wx");
			try {
				await handle.writeFile(String(process.pid));
			} finally {
				await handle.close();
			}
			return;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
		let lock_stat;
		try {
			lock_stat = await stat(lock_path);
		} catch {
			continue;
		}
		if (Date.now() - lock_stat.mtimeMs > stale_ms) {
			const reclaim_path = `${lock_path}.reclaim.${process.pid}.${randomUUID()}`;
			try {
				await rename(lock_path, reclaim_path);
				await rm(reclaim_path, { force: true });
			} catch {}
			continue;
		}
		if (Date.now() >= deadline_ms) throw new Error(`codex usage store: lock timeout after ${timeout_ms}ms (${lock_path})`);
		await delay(LOCK_RETRY_INTERVAL_MS);
	}
}
function isStrictlyNewer(candidate_observed_at, current_observed_at) {
	return Date.parse(candidate_observed_at) > Date.parse(current_observed_at);
}
async function writeCodexUsageSnapshot(observation, options = {}) {
	const env = options.env ?? process.env;
	const now_ms = options.now_ms ?? Date.now();
	const candidate = validateCodexUsageSnapshot({
		...observation,
		updated_at: new Date(now_ms).toISOString()
	});
	if (candidate === null) return "rejected_invalid";
	if (!isObservedAtPlausible(candidate.observed_at, now_ms)) return "rejected_invalid";
	const file_path = resolveCodexUsageFilePath(env);
	await mkdir(path.dirname(file_path), { recursive: true });
	const lock_path = `${file_path}.lock`;
	await acquireLock(lock_path, options.lock_timeout_ms ?? DEFAULT_LOCK_TIMEOUT_MS, options.lock_stale_ms ?? DEFAULT_LOCK_STALE_MS);
	try {
		const current = await readSnapshotFromFile(file_path, now_ms);
		if (current !== null && !isStrictlyNewer(candidate.observed_at, current.observed_at)) return "skipped_older";
		const temp_path = `${file_path}.tmp.${process.pid}.${randomUUID()}`;
		await writeFile(temp_path, `${JSON.stringify(candidate, null, 2)}\n`);
		await rename(temp_path, file_path);
		return "written";
	} finally {
		await rm(lock_path, { force: true });
	}
}
//#endregion
//#region .publish/ddd-workflow/scripts/custom-statusline/core/resolve-provider.ts
var OPENAI_CODEX_ID_PREFIXES = [
	"gpt-",
	"codex,",
	"openai/"
];
function resolveModelId(model) {
	if (typeof model === "string") return model;
	if (typeof model !== "object" || model === null) return null;
	const { id } = model;
	return typeof id === "string" ? id : null;
}
function resolveProvider(model) {
	const model_id = resolveModelId(model);
	if (model_id === null) return "unknown";
	if (model_id.startsWith("claude-")) return "anthropic";
	if (OPENAI_CODEX_ID_PREFIXES.some((prefix) => model_id.startsWith(prefix))) return "openai-codex";
	return "unknown";
}
function resolveModelDisplayName(model) {
	if (typeof model === "string") return model;
	if (typeof model !== "object" || model === null) return null;
	const { display_name } = model;
	if (typeof display_name === "string") return display_name;
	return resolveModelId(model);
}
var RST = "\x1B[0m";
var DIM = "\x1B[2m";
var WHITE = "\x1B[1;37m";
var GREEN = "\x1B[32m";
var YELLOW = "\x1B[33m";
var RED = "\x1B[31m";
var CYAN = "\x1B[36m";
function formatModel(raw_id) {
	const suffix = /\[1[mM]\]|\(1M context\)/.test(raw_id) ? "[1M]" : "";
	const raw = raw_id.replace(/\[[\s\S]*$/, "").replace(/\s*\(1M context\)\s*$/, "");
	const with_minor = raw.match(/^claude-([a-z]+)-([0-9]+)-([0-9]+)/);
	if (with_minor !== null) return `${capitalize(with_minor[1])} ${with_minor[2]}.${with_minor[3]}${suffix}`;
	const major_only = raw.match(/^claude-([a-z]+)-([0-9]+)$/);
	if (major_only !== null) return `${capitalize(major_only[1])} ${major_only[2]}${suffix}`;
	return `${raw}${suffix}`;
}
function capitalize(word) {
	return word.charAt(0).toUpperCase() + word.slice(1);
}
function formatTokens(tokens) {
	if (tokens >= 1e3) return `${Math.floor(tokens / 1e3)}k`;
	return `${tokens}`;
}
function normalizePct(pct) {
	const rounded = Number.isFinite(pct) ? Math.round(pct) : 0;
	if (rounded < 0) return 0;
	if (rounded > 100) return 100;
	return rounded;
}
function pctToFilled(pct, width) {
	return Math.floor((pct * width + 50) / 100);
}
function colorByPct(pct) {
	if (pct >= 80) return RED;
	if (pct >= 60) return YELLOW;
	return GREEN;
}
function quotaColor(pct) {
	if (pct >= 90) return RED;
	if (pct >= 80) return YELLOW;
	return CYAN;
}
function makeBar(filled, width, color) {
	const clamped = Math.min(Math.max(filled, 0), width);
	const empty = width - clamped;
	let bar = "";
	if (clamped > 0) bar += `${color}${"█".repeat(clamped)}${RST}`;
	if (empty > 0) bar += `${DIM}${"░".repeat(empty)}${RST}`;
	return bar;
}
function nbspify(text) {
	return text.replaceAll(" ", "\xA0");
}
var MIN_PCT_FIELD_WIDTH = 3;
function pctText(pct) {
	return pct === null ? "--" : `${pct}`;
}
function resolvePctFieldWidth(bar_rows) {
	let width = MIN_PCT_FIELD_WIDTH;
	for (const row of bar_rows) width = Math.max(width, `${pctText(row.pct)}%`.length);
	return width;
}
function makeBarRowLine(label, bar, pct_text, extra, pct_width, pct_color) {
	return nbspify(`${label.padEnd(7)} ${bar} ${pct_color}${`${pct_text}%`.padEnd(pct_width)}${RST} | ${extra}`);
}
var SEP = ` | `;
function renderStatuslineView(view) {
	const model_display = view.effort_level !== null && view.effort_level !== "" ? `${view.model_short} ${view.effort_level}` : view.model_short;
	let output = `${RST}${`${nbspify("Model:")} ${WHITE}${nbspify(model_display)}${RST}${SEP}${nbspify("Dir:")} ${WHITE}${nbspify(view.dir_name)}${RST}`}`;
	const pct_width = resolvePctFieldWidth(view.bar_rows);
	for (const row of view.bar_rows) {
		const filled = row.pct === null ? 0 : pctToFilled(row.pct, 25);
		const stale = row.stale === true;
		const bar = makeBar(filled, 25, row.pct === null ? "" : stale ? DIM : row.scheme === "context" ? colorByPct(row.pct) : quotaColor(row.pct));
		output += `\n${RST}${makeBarRowLine(row.label, bar, pctText(row.pct), row.extra, pct_width, stale ? DIM : WHITE)}`;
	}
	if (view.git !== null && view.git.branch !== "") {
		const untracked_str = view.git.untracked > 0 ? `, ${YELLOW}?${view.git.untracked}${RST}` : "";
		const diff_str = ` (${GREEN}+${view.git.insertions}${RST}, ${RED}-${view.git.deletions}${RST}${untracked_str})`;
		output += `\n${RST}${nbspify("Branch:")} ${WHITE}${nbspify(view.git.branch)}${RST}${diff_str}`;
	}
	return output;
}
//#endregion
//#region .publish/ddd-workflow/scripts/custom-statusline/entry/claude-statusline-entry.ts
var CONTEXT_CAP = 25e4;
var DEFAULT_INVOCATION_LOG_PATH = "/tmp/claude/statusline-invocations.log";
var DEFAULT_INPUT_LOG_PATH = "/tmp/claude/statusline-input.jsonl";
async function renderStatusline(stdin_input, options = {}) {
	const env = options.env ?? process.env;
	const now_ms = options.now_ms ?? Date.now();
	const status = parseClaudeStatusJson(stdin_input);
	await logStatuslineInput(stdin_input, env, now_ms);
	const provider = resolveProvider(status.model);
	const model_id = status.model?.id ?? "";
	const ctx_tokens = await resolveContextTokens(computeContextTokens(status.context_window), status.session_id, env);
	const ctx_window_size = status.context_window?.context_window_size ?? 0;
	const ctx_max = ctx_window_size > 0 && ctx_window_size < CONTEXT_CAP ? ctx_window_size : CONTEXT_CAP;
	const ctx_pct = normalizePct(Math.floor(ctx_tokens * 100 / ctx_max));
	const five_hour = readRateLimitWindow(status.rate_limits, "five_hour");
	const seven_day = readRateLimitWindow(status.rate_limits, "seven_day");
	const status_weekly_pct = normalizePct(seven_day.used_pct);
	let session_pct = five_hour.used_pct;
	let session_resets_at = five_hour.resets_at;
	let weekly_pct = 0;
	let weekly_reset = "--";
	let session_stale = false;
	let weekly_stale = false;
	if (provider === "anthropic") {
		const usage = await collectAnthropicOauthUsage({
			env,
			now_ms,
			fetch_fn: options.fetch_fn
		});
		if (usage.five_hour.resets_at !== null && isUsableUsageWindow(usage.five_hour.resets_at, usage.is_stale, now_ms)) {
			const status_pct = normalizePct(session_pct);
			const api_pct = normalizePct(usage.five_hour.utilization);
			const api_resets_at = isoToEpochSeconds(usage.five_hour.resets_at);
			const keep_status = isSameWindowRegression(session_resets_at, api_resets_at, status_pct, api_pct);
			session_pct = keep_status ? status_pct : api_pct;
			session_resets_at = api_resets_at;
			session_stale = usage.is_stale && !keep_status;
		}
		if (usage.seven_day.resets_at !== null && isUsableUsageWindow(usage.seven_day.resets_at, usage.is_stale, now_ms)) {
			const api_weekly_pct = normalizePct(usage.seven_day.utilization);
			const api_weekly_resets_at = isoToEpochSeconds(usage.seven_day.resets_at);
			const keep_status = isSameWindowRegression(seven_day.resets_at, api_weekly_resets_at, status_weekly_pct, api_weekly_pct);
			weekly_pct = keep_status ? status_weekly_pct : api_weekly_pct;
			weekly_reset = api_weekly_resets_at > 0 ? formatResetClock(api_weekly_resets_at, env.TZ) : "--";
			weekly_stale = usage.is_stale && !keep_status;
		} else if (seven_day.resets_at > 0 || status_weekly_pct > 0) {
			weekly_pct = status_weekly_pct;
			if (seven_day.resets_at > 0) weekly_reset = formatResetClock(seven_day.resets_at, env.TZ);
		}
	}
	session_pct = normalizePct(session_pct);
	const now_seconds = Math.floor(now_ms / 1e3);
	let timer_str = "--:--";
	if (session_resets_at > 0 && session_resets_at > now_seconds) timer_str = format30HourResetClock(session_resets_at, env.TZ);
	const bar_rows = [{
		label: "Context",
		pct: ctx_pct,
		scheme: "context",
		extra: formatTokens(ctx_tokens)
	}];
	if (provider === "anthropic") {
		bar_rows.push({
			label: "Session",
			pct: session_pct,
			scheme: "quota",
			extra: timer_str,
			stale: session_stale
		});
		bar_rows.push({
			label: "Weekly",
			pct: weekly_pct,
			scheme: "quota",
			extra: weekly_reset,
			stale: weekly_stale
		});
	} else if (provider === "openai-codex") {
		const codex_quota = await resolveCodexQuotaWindows(status.rate_limits, env, now_ms, options);
		bar_rows.push(...buildCodexQuotaRows(codex_quota.windows, now_ms, env.TZ, codex_quota.stale));
	} else bar_rows.push({
		label: "Quota",
		pct: null,
		scheme: "quota",
		extra: "--"
	});
	const project_dir = status.project_dir ?? options.cwd ?? "";
	const dir_name = basename(project_dir) || "~";
	const git_view = await collectGitView(project_dir, options.git_runner ?? defaultGitRunner);
	await logStatuslineInvocation(env, now_ms, {
		model_id,
		project_dir,
		used_pct: session_pct,
		resets_at: session_resets_at
	});
	return renderStatuslineView({
		model_short: formatModel(resolveModelDisplayName(status.model) ?? ""),
		effort_level: status.effort_level,
		dir_name,
		bar_rows,
		git: git_view
	});
}
var CODEX_FETCH_THROTTLE_SECONDS = 60;
var SECONDS_PER_DAY = 86400;
var SECONDS_PER_HOUR = 3600;
var MINUTES_PER_DAY = 1440;
function codexFetchThrottlePath(env) {
	return `${resolveCodexUsageFilePath(env)}.fetch-throttle`;
}
async function fileAgeSeconds(file_path, now_ms) {
	let file_stat;
	try {
		file_stat = await stat(file_path);
	} catch {
		return null;
	}
	return Math.floor(now_ms / 1e3) - Math.floor(file_stat.mtimeMs / 1e3);
}
async function markCodexFetchAttempt(env, now_ms) {
	const marker_path = codexFetchThrottlePath(env);
	try {
		await mkdir(path.dirname(marker_path), { recursive: true });
		await writeFile(marker_path, "");
		const mtime = new Date(now_ms);
		await utimes(marker_path, mtime, mtime);
	} catch {}
}
var CALLBACK_RATE_LIMIT_WINDOWS = [{
	key: "five_hour",
	window_minutes: 300
}, {
	key: "seven_day",
	window_minutes: 10080
}];
function parseCodexCallbackWindows(rate_limits, now_ms) {
	if (rate_limits === null) return [];
	const windows = [];
	for (const { key, window_minutes } of CALLBACK_RATE_LIMIT_WINDOWS) {
		const value = rate_limits[key];
		if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
		const record = value;
		const resets = record.resets_at;
		windows.push({
			used_percent: isValidUsedPercent(record.used_percentage) ? record.used_percentage : null,
			reset_at: typeof resets === "number" && Number.isFinite(resets) && resets > 0 ? resets : null,
			window_minutes
		});
	}
	return windows.filter((window) => isWindowActive(window, now_ms));
}
function activeSnapshotWindows(snapshot, now_ms) {
	return [snapshot.primary, snapshot.secondary].filter((window) => isWindowActive(window, now_ms));
}
async function readStaleCodexWindows(env, now_ms) {
	const snapshot = await readCodexUsageRaw({
		env,
		now_ms
	});
	if (snapshot === null) return [];
	if (!isObservedAtPlausible(snapshot.observed_at, now_ms)) return [];
	if (isObservationFresh(snapshot.observed_at, now_ms, resolveMaxAgeSeconds(env))) return [];
	return activeSnapshotWindows(snapshot, now_ms);
}
async function resolveCodexQuotaWindows(rate_limits, env, now_ms, options) {
	const callback_windows = parseCodexCallbackWindows(rate_limits, now_ms);
	if (callback_windows.length > 0) return {
		windows: callback_windows,
		stale: false
	};
	const fresh = await readCodexUsageFresh({
		env,
		now_ms
	});
	const throttle_age = await fileAgeSeconds(codexFetchThrottlePath(env), now_ms);
	if (throttle_age !== null && throttle_age < CODEX_FETCH_THROTTLE_SECONDS) {
		if (fresh !== null) return {
			windows: activeSnapshotWindows(fresh, now_ms),
			stale: false
		};
		return {
			windows: await readStaleCodexWindows(env, now_ms),
			stale: true
		};
	}
	await markCodexFetchAttempt(env, now_ms);
	const result = await fetchCodexUsage({
		fetch_fn: options.codex_fetch_fn,
		auth_file_path: options.codex_auth_file_path,
		now_ms
	});
	if (result.ok) {
		try {
			await writeCodexUsageSnapshot(result.observation, {
				env,
				now_ms
			});
		} catch {}
		return {
			windows: activeSnapshotWindows(result.observation, now_ms),
			stale: false
		};
	}
	const fallback = await readCodexUsageFresh({
		env,
		now_ms
	});
	if (fallback !== null) return {
		windows: activeSnapshotWindows(fallback, now_ms),
		stale: false
	};
	return {
		windows: await readStaleCodexWindows(env, now_ms),
		stale: true
	};
}
function formatCodexCountdown(remaining_seconds) {
	if (remaining_seconds >= SECONDS_PER_DAY) return `${Math.floor(remaining_seconds / SECONDS_PER_DAY)}d ${Math.floor(remaining_seconds % SECONDS_PER_DAY / SECONDS_PER_HOUR)}h`;
	return `${Math.floor(remaining_seconds / SECONDS_PER_HOUR)}h ${Math.floor(remaining_seconds % SECONDS_PER_HOUR / 60)}m`;
}
function isSubDayWindow(window_minutes) {
	return typeof window_minutes === "number" && Number.isFinite(window_minutes) && window_minutes > 0 && window_minutes < MINUTES_PER_DAY;
}
function formatCodexWindowReset(window, now_seconds, time_zone) {
	const reset_at = window.reset_at;
	if (isSubDayWindow(window.window_minutes)) return format30HourResetClock(reset_at, time_zone);
	return formatCodexCountdown(reset_at - now_seconds);
}
function buildCodexQuotaRows(windows, now_ms, time_zone, stale) {
	if (windows.length === 0) return [{
		label: "Quota",
		pct: null,
		scheme: "quota",
		extra: "--"
	}];
	const now_seconds = Math.floor(now_ms / 1e3);
	return [...windows].sort((a, b) => (a.window_minutes ?? Number.MAX_SAFE_INTEGER) - (b.window_minutes ?? Number.MAX_SAFE_INTEGER)).map((window) => ({
		label: windowLabel(window.window_minutes, STATUSLINE_WINDOW_LABEL_OVERRIDES) ?? "Quota",
		pct: window.used_percent === null ? null : normalizePct(window.used_percent),
		scheme: "quota",
		extra: formatCodexWindowReset(window, now_seconds, time_zone),
		stale
	}));
}
function computeContextTokens(context_window) {
	if (context_window === null) return 0;
	const { current_usage } = context_window;
	if (typeof current_usage === "number") return current_usage;
	if (current_usage !== null) return (current_usage.input_tokens ?? 0) + (current_usage.cache_creation_input_tokens ?? 0) + (current_usage.cache_read_input_tokens ?? 0);
	return (context_window.total_input_tokens ?? 0) + (context_window.total_output_tokens ?? 0);
}
var DEFAULT_CONTEXT_CACHE_DIR = "/tmp/claude/statusline-context";
function resolveContextCacheDir(env) {
	const value = env.STATUSLINE_CONTEXT_CACHE_DIR;
	return value === void 0 || value === "" ? DEFAULT_CONTEXT_CACHE_DIR : value;
}
function contextCacheFilePath(env, session_id) {
	const safe_name = session_id.replaceAll("/", "_").replaceAll("\\", "_");
	return path.join(resolveContextCacheDir(env), `${safe_name}.json`);
}
async function readCachedContextTokens(file_path) {
	try {
		const tokens = JSON.parse(await readFile(file_path, "utf8")).tokens;
		return typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0 ? tokens : null;
	} catch {
		return null;
	}
}
async function writeCachedContextTokens(file_path, tokens) {
	try {
		await mkdir(path.dirname(file_path), { recursive: true });
		await writeFile(file_path, JSON.stringify({ tokens }));
	} catch {}
}
async function resolveContextTokens(raw_tokens, session_id, env) {
	if (session_id === null || session_id === "") return raw_tokens;
	const file_path = contextCacheFilePath(env, session_id);
	if (raw_tokens > 0) {
		await writeCachedContextTokens(file_path, raw_tokens);
		return raw_tokens;
	}
	return await readCachedContextTokens(file_path) ?? raw_tokens;
}
function readRateLimitWindow(rate_limits, key) {
	const window = rate_limits?.[key];
	const record = typeof window === "object" && window !== null && !Array.isArray(window) ? window : null;
	const used = record?.used_percentage;
	const resets = record?.resets_at;
	return {
		used_pct: Math.round(typeof used === "number" && Number.isFinite(used) ? used : 0),
		resets_at: typeof resets === "number" && Number.isFinite(resets) ? resets : 0
	};
}
function isoToEpochSeconds(value) {
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? Math.floor(ms / 1e3) : 0;
}
function isUsableUsageWindow(resets_at, is_stale, now_ms) {
	if (!is_stale) return true;
	const reset_seconds = isoToEpochSeconds(resets_at);
	return reset_seconds > 0 && !isWindowElapsed(reset_seconds, now_ms);
}
function isSameWindowRegression(status_resets_at, api_resets_at, status_pct, api_pct) {
	if (status_resets_at <= 0 || api_resets_at <= 0) return false;
	return Math.abs(api_resets_at - status_resets_at) <= 60 && api_pct < status_pct;
}
function roundEpochToMinute(epoch_seconds) {
	return Math.round(epoch_seconds / 60) * 60;
}
function format30HourResetClock(epoch_seconds, time_zone) {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: time_zone === void 0 || time_zone === "" ? void 0 : time_zone,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23"
		}).formatToParts(/* @__PURE__ */ new Date(roundEpochToMinute(epoch_seconds) * 1e3));
		const part = (type) => parts.find((candidate) => candidate.type === type)?.value ?? "";
		const minute = part("minute");
		let hour = Number.parseInt(part("hour"), 10);
		if (!Number.isFinite(hour) || minute === "") return "--:--";
		if (hour < 6) hour += 24;
		return `${String(hour).padStart(2, "0")}:${minute}`;
	} catch {
		return "--:--";
	}
}
function formatResetClock(epoch_seconds, time_zone) {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: time_zone === void 0 || time_zone === "" ? void 0 : time_zone,
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23"
		}).formatToParts(/* @__PURE__ */ new Date(roundEpochToMinute(epoch_seconds) * 1e3));
		const part = (type) => parts.find((candidate) => candidate.type === type)?.value ?? "";
		return `${part("weekday")} ${part("hour")}:${part("minute")}`;
	} catch {
		return "--";
	}
}
function basename(dir_path) {
	return dir_path.slice(dir_path.lastIndexOf("/") + 1);
}
var defaultGitRunner = (args) => execFileSync("git", args, {
	encoding: "utf8",
	stdio: [
		"ignore",
		"pipe",
		"ignore"
	]
});
function tryGit(run_git, args) {
	try {
		return run_git(args).replace(/\n+$/, "");
	} catch {
		return "";
	}
}
async function collectGitView(project_dir, run_git) {
	if (project_dir === "" || !await isDirectory(project_dir)) return null;
	const branch = tryGit(run_git, [
		"-C",
		project_dir,
		"branch",
		"--show-current"
	]);
	const shortstat = tryGit(run_git, [
		"-C",
		project_dir,
		"diff",
		"--shortstat"
	]);
	const untracked_out = tryGit(run_git, [
		"-C",
		project_dir,
		"ls-files",
		"--others",
		"--exclude-standard"
	]);
	const detached_sha = branch === "" ? tryGit(run_git, [
		"-C",
		project_dir,
		"rev-parse",
		"--short",
		"HEAD"
	]) : "";
	const ref = branch === "" ? formatDetachedRef(detached_sha) : branch;
	if (ref === "") return null;
	return {
		branch: ref,
		insertions: parseShortstatCount(shortstat, /(\d+) insertion/),
		deletions: parseShortstatCount(shortstat, /(\d+) deletion/),
		untracked: countLines(untracked_out)
	};
}
function formatDetachedRef(short_sha) {
	return short_sha === "" ? "" : `@${short_sha}`;
}
function countLines(text) {
	return text === "" ? 0 : text.split("\n").length;
}
async function isDirectory(dir_path) {
	try {
		return (await stat(dir_path)).isDirectory();
	} catch {
		return false;
	}
}
function parseShortstatCount(shortstat, pattern) {
	const matched = shortstat.match(pattern);
	return matched === null ? 0 : Number.parseInt(matched[1], 10);
}
function resolveInvocationLogPath(env) {
	const value = env.STATUSLINE_INVOCATION_LOG;
	const resolved = value === void 0 || value === "" ? DEFAULT_INVOCATION_LOG_PATH : value;
	return resolved === "0" ? null : resolved;
}
function resolveInputLogPath(env) {
	const value = env.STATUSLINE_INPUT_LOG;
	if (value === void 0) return DEFAULT_INPUT_LOG_PATH;
	return value === "" || value === "0" ? null : value;
}
async function appendLogLine(log_path, line) {
	try {
		await mkdir(path.dirname(log_path), { recursive: true });
		await appendFile(log_path, line);
	} catch {}
}
async function logStatuslineInput(input, env, now_ms) {
	const log_path = resolveInputLogPath(env);
	if (log_path === null) return;
	let payload;
	try {
		payload = JSON.parse(input);
	} catch {
		return;
	}
	await appendLogLine(log_path, `${JSON.stringify({
		ts: formatIsoWithOffset(now_ms),
		payload
	})}\n`);
}
async function logStatuslineInvocation(env, now_ms, fields) {
	const log_path = resolveInvocationLogPath(env);
	if (log_path === null) return;
	const sanitize = (value) => value.replaceAll("	", " ").replaceAll("\n", " ");
	await appendLogLine(log_path, `${[
		formatIsoWithOffset(now_ms),
		`pid=${process.pid}`,
		`ppid=${process.ppid}`,
		"mode=full",
		"cols=",
		`model=${sanitize(fields.model_id)}`,
		`project=${sanitize(fields.project_dir)}`,
		`usage=${fields.used_pct}`,
		`reset_at=${fields.resets_at}`
	].join("	")}\n`);
}
function formatIsoWithOffset(now_ms) {
	const date = new Date(now_ms);
	const pad = (value) => String(value).padStart(2, "0");
	const offset_minutes = -date.getTimezoneOffset();
	const sign = offset_minutes >= 0 ? "+" : "-";
	const abs_offset = Math.abs(offset_minutes);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs_offset / 60))}:${pad(abs_offset % 60)}`;
}
//#endregion
//#region .publish/ddd-workflow/scripts/custom-statusline/entry/claude-statusline-bin.ts
async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}
var stdin_input = await readStdin();
try {
	process.stdout.write(await renderStatusline(stdin_input));
} catch {
	process.stdout.write("");
}
//#endregion
export {};

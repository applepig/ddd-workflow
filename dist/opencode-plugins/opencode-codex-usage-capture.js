import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
function isObservedAtPlausible(observed_at, now_ms) {
	if (typeof observed_at !== "string") return false;
	const observed_ms = Date.parse(observed_at);
	if (!Number.isFinite(observed_ms)) return false;
	return observed_ms - now_ms <= 300 * 1e3;
}
function isValidUsedPercent(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}
//#endregion
//#region .publish/ddd-workflow/scripts/custom-statusline/collectors/codex-quota-headers.ts
function stringHeader(get_header, name) {
	const raw = get_header(name);
	if (raw === null) return null;
	const trimmed = raw.trim();
	return trimmed === "" ? null : trimmed;
}
function numberHeader(get_header, name) {
	const value = stringHeader(get_header, name);
	if (value === null) return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return parsed;
}
function positiveNumberHeader(get_header, name) {
	const parsed = numberHeader(get_header, name);
	return parsed !== null && parsed > 0 ? parsed : null;
}
function percentHeader(get_header, name) {
	const parsed = numberHeader(get_header, name);
	return isValidUsedPercent(parsed) ? parsed : null;
}
function booleanHeader(get_header, name) {
	const value = stringHeader(get_header, name);
	if (value === null) return null;
	const lowered = value.toLowerCase();
	if (lowered === "true") return true;
	if (lowered === "false") return false;
	return null;
}
function quotaWindow(get_header, ordinal) {
	const window = {
		used_percent: percentHeader(get_header, `x-codex-${ordinal}-used-percent`),
		reset_at: positiveNumberHeader(get_header, `x-codex-${ordinal}-reset-at`),
		window_minutes: positiveNumberHeader(get_header, `x-codex-${ordinal}-window-minutes`)
	};
	return window.used_percent !== null || window.reset_at !== null || window.window_minutes !== null ? window : null;
}
function credits(get_header) {
	const parsed = {
		has_credits: booleanHeader(get_header, "x-codex-credits-has-credits"),
		unlimited: booleanHeader(get_header, "x-codex-credits-unlimited")
	};
	return parsed.has_credits !== null || parsed.unlimited !== null ? parsed : null;
}
function collectCodexQuotaHeaders(get_header, observed_at) {
	const observation = {
		schema_version: 2,
		provider: "openai",
		source: "opencode-capture",
		observed_at,
		plan_type: stringHeader(get_header, "x-codex-plan-type"),
		active_limit: stringHeader(get_header, "x-codex-active-limit"),
		credits: credits(get_header),
		primary: quotaWindow(get_header, "primary"),
		secondary: quotaWindow(get_header, "secondary")
	};
	return observation.plan_type !== null || observation.active_limit !== null || observation.credits !== null || observation.primary !== null || observation.secondary !== null ? observation : null;
}
//#endregion
//#region .publish/ddd-workflow/scripts/custom-statusline/core/codex-usage-store.ts
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
//#region .publish/ddd-workflow/scripts/opencode/opencode-codex-usage-capture.js
var CODEX_USAGE_CAPTURE = Symbol.for("opencode.codexUsageCapture.fetch");
var CODEX_PATH = "/backend-api/codex/responses";
var LOG_FILE = "openai-response-debug.ndjson";
var DEBUG = process.env.OPENCODE_CODEX_USAGE_DEBUG === "1";
function logPath() {
	return path.join(path.dirname(resolveCodexUsageFilePath()), LOG_FILE);
}
function requestUrl(input) {
	try {
		return input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
	} catch {
		return;
	}
}
function isCodexResponseRequest(input) {
	const url = requestUrl(input);
	return url?.host === "chatgpt.com" && url.pathname === CODEX_PATH;
}
function codexHeadersObject(headers) {
	return Object.fromEntries([...headers.entries()].filter(([key]) => key.startsWith("x-codex-")).sort(([a], [b]) => a.localeCompare(b)));
}
async function writeDebug(startedAt, url, response, storeWrite) {
	if (!DEBUG) return;
	const file = logPath();
	await mkdir(path.dirname(file), { recursive: true });
	await appendFile(file, `${JSON.stringify({
		time: (/* @__PURE__ */ new Date()).toISOString(),
		duration_ms: Date.now() - startedAt,
		request: {
			host: url.host,
			pathname: url.pathname
		},
		response: {
			status: response.status,
			status_text: response.statusText,
			headers: codexHeadersObject(response.headers)
		},
		store_write: storeWrite
	})}\n`);
}
function capture(startedAt, requestInput, response) {
	const url = requestUrl(requestInput);
	if (!url || !isCodexResponseRequest(url)) return;
	const observation = collectCodexQuotaHeaders((name) => response.headers.get(name), (/* @__PURE__ */ new Date()).toISOString());
	if (!observation) {
		writeDebug(startedAt, url, response, "no_observation").catch(() => {});
		return;
	}
	writeCodexUsageSnapshot(observation).then((result) => writeDebug(startedAt, url, response, result)).catch(() => {});
}
var opencode_codex_usage_capture_default = {
	id: "ddd:opencode-codex-usage-capture",
	server: async () => {
		if (globalThis[CODEX_USAGE_CAPTURE]) return {};
		const originalFetch = globalThis.fetch.bind(globalThis);
		globalThis[CODEX_USAGE_CAPTURE] = originalFetch;
		globalThis.fetch = async (requestInput, init) => {
			const startedAt = Date.now();
			const response = await originalFetch(requestInput, init);
			capture(startedAt, requestInput, response);
			return response;
		};
		return {};
	}
};
//#endregion
export { opencode_codex_usage_capture_default as default };

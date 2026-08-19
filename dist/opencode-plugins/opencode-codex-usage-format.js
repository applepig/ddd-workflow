import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
//#region .publish/ddd-workflow/scripts/custom-statusline/core/quota-window.ts
var OPENCODE_WINDOW_LABEL_OVERRIDES = {};
var MINUTES_PER_WEEK = 10080;
var MINUTES_PER_DAY = 1440;
var MINUTES_PER_HOUR = 60;
function resolveWindowKind(window_minutes) {
	if (typeof window_minutes !== "number" || !Number.isFinite(window_minutes) || window_minutes <= 0) return null;
	if (window_minutes % MINUTES_PER_WEEK === 0) return {
		unit: "week",
		count: window_minutes / MINUTES_PER_WEEK
	};
	if (window_minutes % MINUTES_PER_DAY === 0) return {
		unit: "day",
		count: window_minutes / MINUTES_PER_DAY
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
function windowLabel$1(window_minutes, overrides = {}) {
	const kind = resolveWindowKind(window_minutes);
	if (kind === null) return null;
	return overrides[window_minutes] ?? genericWindowLabel(kind);
}
function isWindowElapsed(reset_at, now_ms) {
	return reset_at <= Math.floor(now_ms / 1e3);
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
//#region .publish/ddd-workflow/scripts/custom-statusline/core/codex-usage-store.ts
var DEFAULT_MAX_AGE_SECONDS = 3600;
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
//#endregion
//#region .publish/ddd-workflow/scripts/opencode/opencode-codex-usage-format.js
function formatRemaining(reset_at, now) {
	if (!reset_at) return "--:--";
	const remaining = Math.floor(reset_at - now / 1e3);
	if (remaining <= 0) return "--:--";
	const days = Math.floor(remaining / 86400);
	const hours = Math.floor(remaining % 86400 / 3600);
	const minutes = Math.floor(remaining % 3600 / 60);
	if (days > 0) return `${days}d${hours}h`;
	if (hours > 0) return `${hours}h${minutes}m`;
	return `${minutes}m`;
}
function windowLabel(window_minutes) {
	return windowLabel$1(window_minutes, OPENCODE_WINDOW_LABEL_OVERRIDES) ?? void 0;
}
function activeLimitRows(usage) {
	const active = [usage?.primary, usage?.secondary].filter((slot) => slot?.reset_at);
	if (active.length === 0) return [{
		label: "wk",
		limit: void 0
	}];
	return active.map((slot) => ({
		label: windowLabel(slot.window_minutes) ?? "wk",
		limit: slot
	}));
}
function validLimitPercent(limit, now) {
	if (!limit) return void 0;
	if (limit.reset_at && isWindowElapsed(limit.reset_at, now)) return void 0;
	if (!isValidUsedPercent(limit.used_percent)) return void 0;
	return Math.round(limit.used_percent);
}
function usedPercent(limit, now, observed_at, max_age_seconds = resolveMaxAgeSeconds()) {
	if (observed_at !== void 0 && !isObservationFresh(observed_at, now, max_age_seconds)) return void 0;
	return validLimitPercent(limit, now);
}
function hasStaleObservation(observed_at, now, max_age_seconds) {
	return observed_at !== void 0 && isObservedAtPlausible(observed_at, now) && !isObservationFresh(observed_at, now, max_age_seconds);
}
function limitColumns(label, limit, now, observed_at, max_age_seconds = resolveMaxAgeSeconds()) {
	const fresh_percent = usedPercent(limit, now, observed_at, max_age_seconds);
	const stale_percent = fresh_percent === void 0 && hasStaleObservation(observed_at, now, max_age_seconds) ? validLimitPercent(limit, now) : void 0;
	const percent_value = stale_percent ?? fresh_percent;
	return {
		label: (windowLabel(limit?.window_minutes) ?? label).padStart(4),
		percent: (percent_value === void 0 ? "--%" : `${percent_value}%`).padStart(4),
		percent_value,
		...stale_percent !== void 0 ? { percent_is_stale: true } : {},
		reset: formatRemaining(limit?.reset_at, now).padStart(5)
	};
}
//#endregion
export { activeLimitRows, formatRemaining, limitColumns, readCodexUsageRaw, usedPercent };

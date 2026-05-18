export function formatRemaining(reset_at, now) {
  if (!reset_at) return "--:--"

  const remaining = Math.max(0, Math.floor(reset_at - now / 1000))
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)

  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${minutes}m`
  return `${minutes}m`
}

export function usedPercent(limit, now) {
  if (!limit) return 0
  if (limit.reset_at && limit.reset_at <= now / 1000) return 0
  return Math.round(limit.used_percent ?? 0)
}

export function limitColumns(label, limit, now) {
  const percent_value = usedPercent(limit, now)

  return {
    label: label.padStart(4),
    percent: `${percent_value}%`.padStart(4),
    percent_value,
    reset: formatRemaining(limit?.reset_at, now).padStart(5),
  }
}

// Pure helpers for the Google Drive folder widget. Kept free of QML types so
// the parsing and formatting can be reasoned about (and tested) on their own.

var FOLDER_GLYPH = "󰉋"
var SYNCED_GLYPH = "󰉖"

function defaultStatus() {
  return {
    ok: true,
    installed: false,
    authenticated: false,
    syncing: false,
    statusText: "Unavailable",
    folderPath: "",
    mountPath: "",
    remoteName: "",
    selectedCount: 0,
    rootFiles: true,
    localBytes: 0,
    usedBytes: 0,
    quotaBytes: 0,
    usagePercent: 0,
    quotaKnown: false,
    browseMounted: false,
    timerEnabled: false,
    lastResult: "",
    lastFinishedTs: 0,
    lastDurationSec: 0,
    baseline: false,
    warning: "",
    lastError: ""
  }
}

function parseJson(raw, fallbackFactory, failureMessage) {
  var text = String(raw || "").trim()
  if (text === "") return fallbackFactory()
  try {
    var parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object") return fallbackFactory()
    return parsed
  } catch (e) {
    var failed = fallbackFactory()
    failed.ok = false
    failed.lastError = failureMessage
    return failed
  }
}

function parseStatus(raw) {
  return parseJson(raw, defaultStatus, "Failed to parse Google Drive status")
}

function parseFolders(raw) {
  var parsed = parseJson(raw, function () {
    return { ok: false, folders: [], staleBytes: 0, rootFiles: true, lastError: "" }
  }, "Failed to parse the Google Drive folder list")
  parsed.folders = Array.isArray(parsed.folders) ? parsed.folders : []
  parsed.staleBytes = Number(parsed.staleBytes || 0)
  return parsed
}

function tr(strings, key, fallback) {
  return strings && typeof strings.t === "function" ? strings.t(key, fallback) : fallback
}

function trn(strings, key, count, fallback) {
  return strings && typeof strings.tn === "function" ? strings.tn(key, count, fallback) : fallback
}

function fmtNum(formatNumber, value, decimals) {
  if (typeof formatNumber === "function") return formatNumber(value, decimals)
  return decimals === undefined ? String(value) : Number(value).toFixed(decimals)
}

var STATUS_KEYS = {
  "Checking…": "status.checking",
  "Not installed": "status.notInstalled",
  "Configuration unavailable": "status.configUnavailable",
  "Needs connection": "status.needsConnection",
  "Folder is a mount": "status.folderIsMount",
  "Syncing…": "status.syncing",
  "Nothing selected": "status.nothingSelected",
  "Waiting for network": "status.waitingNetwork",
  "Sync failed": "status.syncFailed",
  "Synced": "status.synced",
  "Ready to sync": "status.ready",
  "Unavailable": "status.unavailable"
}

function translateStatus(statusText, strings) {
  var text = String(statusText || "")
  var key = STATUS_KEYS[text]
  return key ? tr(strings, key, text) : text
}

function formatBytes(bytes, formatNumber) {
  var value = Number(bytes || 0)
  if (!isFinite(value) || value <= 0) return fmtNum(formatNumber, 0) + " B"
  var units = ["B", "KB", "MB", "GB", "TB", "PB"]
  var index = 0
  while (value >= 1000 && index < units.length - 1) {
    value = value / 1000
    index++
  }
  var decimals = value >= 100 || index === 0 ? 0 : (value >= 10 ? 1 : 2)
  var rounded = Number(value.toFixed(decimals))
  return fmtNum(formatNumber, rounded) + " " + units[index]
}

function relativeTime(timestampSec, nowMs, strings, formatNumber) {
  var ts = Number(timestampSec || 0)
  if (!isFinite(ts) || ts <= 0) return tr(strings, "time.never", "Never")
  var now = nowMs === undefined || nowMs === null ? Date.now() : Number(nowMs)
  var diff = Math.max(0, Math.floor((now - ts * 1000) / 1000))
  if (diff < 45) return tr(strings, "time.justNow", "Just now")
  var minutes = Math.floor(diff / 60)
  if (minutes < 60) {
    var m = Math.max(1, minutes)
    return tr(strings, "time.minutesAgo", "%1m ago").replace("%1", fmtNum(formatNumber, m))
  }
  var hours = Math.floor(minutes / 60)
  if (hours < 24) return tr(strings, "time.hoursAgo", "%1h ago").replace("%1", fmtNum(formatNumber, hours))
  var days = Math.floor(hours / 24)
  if (days < 30) return tr(strings, "time.daysAgo", "%1d ago").replace("%1", fmtNum(formatNumber, days))
  var months = Math.floor(days / 30)
  if (months < 12) return tr(strings, "time.monthsAgo", "%1mo ago").replace("%1", fmtNum(formatNumber, months))
  return tr(strings, "time.yearsAgo", "%1y ago").replace("%1", fmtNum(formatNumber, Math.floor(days / 365)))
}

function usageText(usedBytes, quotaBytes, quotaKnown, strings, formatNumber) {
  if (quotaKnown && Number(quotaBytes || 0) > 0)
    return tr(strings, "info.usageOf", "%1 of %2")
      .replace("%1", formatBytes(usedBytes, formatNumber))
      .replace("%2", formatBytes(quotaBytes, formatNumber))
  return formatBytes(usedBytes, formatNumber)
}

// One line describing what the folder currently holds.
function folderSummary(status, strings, formatNumber) {
  if (!status) return ""
  var count = Number(status.selectedCount || 0)
  var parts = []
  parts.push(
    count === 0
      ? tr(strings, "summary.noFolders", "No folders")
      : trn(strings, "summary.folders", count, count === 1 ? "%1 folder" : "%1 folders")
          .replace("%1", fmtNum(formatNumber, count))
  )
  if (status.rootFiles) parts.push(tr(strings, "summary.rootFiles", "root files"))
  var sizeText = formatBytes(status.localBytes, formatNumber)
  if (status.localBytesApprox) sizeText = tr(strings, "info.approxValue", "≈ %1").replace("%1", sizeText)
  parts.push(tr(strings, "summary.onDisk", "%1 on disk").replace("%1", sizeText))
  return parts.join(" · ")
}

function folderMeta(folder, strings, formatNumber) {
  if (!folder) return ""
  var bytes = formatBytes(folder.localBytes, formatNumber)
  if (folder.approx) bytes = tr(strings, "info.approxValue", "≈ %1").replace("%1", bytes)
  if (folder.missing) return tr(strings, "folder.notInDrive", "Not in Drive · %1 on disk").replace("%1", bytes)
  if (folder.stale) return tr(strings, "folder.noLongerSyncing", "No longer syncing · %1").replace("%1", bytes)
  if (folder.selected) {
    return folder.onDisk
      ? tr(strings, "folder.onDisk", "%1 on disk").replace("%1", bytes)
      : tr(strings, "folder.waitingFirstSync", "Waiting for first sync")
  }
  return tr(strings, "folder.notSynced", "Not synced")
}

function folderGlyph(folder) {
  return folder && folder.selected ? SYNCED_GLYPH : FOLDER_GLYPH
}

// The loose files at the very top of Drive, which belong to no folder.
function rootFilesMeta(count, bytes, localCount, localBytes, strings, formatNumber) {
  var n = Number(count || 0)
  var have = Number(localCount || 0)
  var onDisk = Number(localBytes || 0)
  var kept = have > 0
    ? " · " + tr(strings, "rootFiles.keptOnDisk", "%1 on disk").replace("%1", formatBytes(onDisk, formatNumber))
    : ""
  if (n <= 0) {
    if (have > 0) {
      return trn(strings, "rootFiles.count", have, have === 1 ? "%1 file" : "%1 files")
        .replace("%1", fmtNum(formatNumber, have)) + kept
    }
    return tr(strings, "rootFiles.empty", "Files that sit in no folder")
  }
  return trn(strings, "rootFiles.count", n, n === 1 ? "%1 file" : "%1 files")
    .replace("%1", fmtNum(formatNumber, n)) + " · " + formatBytes(bytes, formatNumber) + kept
}

function shortHomePath(path, home) {
  var value = String(path || "")
  var prefix = String(home || "")
  if (prefix !== "" && value === prefix) return "~"
  if (prefix !== "" && value.indexOf(prefix + "/") === 0) return "~" + value.substring(prefix.length)
  return value
}

if (typeof module !== "undefined") {
  module.exports = {
    defaultStatus: defaultStatus,
    parseStatus: parseStatus,
    parseFolders: parseFolders,
    translateStatus: translateStatus,
    formatBytes: formatBytes,
    relativeTime: relativeTime,
    usageText: usageText,
    folderSummary: folderSummary,
    folderMeta: folderMeta,
    folderGlyph: folderGlyph,
    rootFilesMeta: rootFilesMeta,
    shortHomePath: shortHomePath
  }
}

/**
 * Minimal at-rest key provider for WorkBuddy's encrypted desktop credential.
 *
 * `dsh-workbuddy-connect` builds its own `WorkBuddyAtRestKeyProvider` with
 * `discovery: 'windows-workbuddy'`, but that class is not part of its public
 * export surface. `WorkBuddyCredentialStore` accepts any object shaped like
 * `{ protectorKeyFor, helperPath }`, so this module supplies that shape using
 * only public Node APIs and the documented helper protocol:
 *
 * 1. Locate `WorkBuddy.exe` (explicit path, then the platform default, then
 *    the uninstall registry keys).
 * 2. Spawn it with `ELECTRON_RUN_AS_NODE=1 -e '<loggerGet script>'`; it prints
 *    `{"version":1,"atRestSecretKey":"<base64 32 bytes>"}`.
 * 3. Derive the AES key as `sha256(atRestSecretKey)` and report its id as the
 *    first 16 hex digits of `sha256(key)`, which is what the credential's
 *    envelope names.
 *
 * Nothing here is persisted: the key lives in memory for the life of the
 * listener, exactly like the upstream implementation.
 *
 * @module dsh-workbuddy-broadcast/at-rest-key
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** The script the WorkBuddy binary runs to print its at-rest secret. */
const HELPER_SCRIPT =
  'process.stdout.write(String(process._linkedBinding("electron_browser_workbuddy_storage").loggerGet()))';

/** Registry roots that record installed applications on Windows. */
const REGISTRY_ROOTS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
];

/** Display names the CN WorkBuddy product registers under. */
const DISPLAY_NAME_PATTERN = /^WorkBuddy(?:\s+\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)?$/u;

/** Whether a path is an existing regular file. */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Read the platform default location of WorkBuddy's Electron binary.
 *
 * Windows: `%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe` (the installer's
 * own location). macOS: the bundle's inner executable, which is what must be
 * spawned with `ELECTRON_RUN_AS_NODE` — launching the `.app` wrapper would
 * start the GUI instead.
 *
 * Linux returns undefined: the desktop app has no published install layout
 * there, and the upstream key provider reports `discovery: none` for it too.
 */
function defaultElectronPath() {
  if (process.platform === "darwin") {
    return "/Applications/WorkBuddy.app/Contents/MacOS/Electron";
  }
  if (process.platform !== "win32") return undefined;
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData !== "string" || localAppData === "") return undefined;
  return join(localAppData, "Programs", "WorkBuddy", "WorkBuddy.exe");
}

/** Run `reg query` and return its stdout, or undefined when it fails. */
function queryRegistry(root) {
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      ["query", root, "/s", "/c", "/f", "WorkBuddy", "/t", "REG_SZ"],
      { timeout: 10000, maxBuffer: 1048576, windowsHide: true },
      (error, stdout) => resolve(error === null ? stdout : undefined),
    );
  });
}

/** Parse a `DisplayIcon` value into a usable `.exe` path. */
function parseDisplayIcon(value) {
  const raw = value.trim();
  let path;
  if (raw.startsWith('"')) {
    const closing = raw.indexOf('"', 1);
    if (closing < 0) return undefined;
    const suffix = raw.slice(closing + 1).trim();
    if (suffix !== "" && !/^,\d+$/u.test(suffix)) return undefined;
    path = raw.slice(1, closing);
  } else {
    const match = /^(.+?\.exe)(?:,\d+)?$/iu.exec(raw);
    if (match === null) return undefined;
    path = match[1];
  }
  path = path.replace(/,\d+$/u, "").trim();
  return /\.exe$/iu.test(path) ? path : undefined;
}

/**
 * Find WorkBuddy's Electron binary through the uninstall registry.
 *
 * Returns the first existing candidate whose display name matches the
 * product. A registry read failure is not an error here: the caller has
 * already tried the platform default, and this is the last resort.
 */
async function discoverFromRegistry() {
  for (const root of REGISTRY_ROOTS) {
    const output = await queryRegistry(root);
    if (output === undefined) continue;
    let currentName;
    for (const line of output.split(/\r?\n/u)) {
      const keyMatch = /^\s*(HKEY_[^\r\n]+?)\s*$/iu.exec(line);
      if (keyMatch !== null) {
        currentName = undefined;
        continue;
      }
      const valueMatch = /^\s+(DisplayName|DisplayIcon)\s+REG_[A-Z0-9_]+\s*(.*?)\s*$/iu.exec(line);
      if (valueMatch === null) continue;
      if (valueMatch[1].toLowerCase() === "displayname") {
        currentName = valueMatch[2] ?? "";
        continue;
      }
      if (currentName === undefined || !DISPLAY_NAME_PATTERN.test(currentName.trim())) continue;
      const candidate = parseDisplayIcon(valueMatch[2] ?? "");
      if (candidate !== undefined && isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** macOS bundle identifier of the China-edition desktop app. */
const MACOS_BUNDLE_ID = "com.tencent.workbuddy.mac";

/** Absolute tool paths; never resolved through PATH, which a user can change. */
const MDFIND_BIN = "/usr/bin/mdfind";
const PLUTIL_BIN = "/usr/bin/plutil";

/** Run one absolute-path tool and resolve its stdout, or undefined. */
function runTool(bin, args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1048576 }, (error, stdout) =>
      resolve(error === null ? stdout : undefined),
    );
  });
}

/**
 * Find WorkBuddy on macOS through Spotlight, then prove each candidate's
 * identity before it can be executed.
 *
 * `mdfind` answers with `.app` bundles (including ones in unusual locations,
 * which is why it beats a hardcoded path); the bundle identifier is then read
 * with `plutil` so a lookalike bundle cannot be executed. A candidate whose
 * identifier cannot be read is skipped rather than trusted.
 */
async function discoverFromSpotlight() {
  const query = `kMDItemCFBundleIdentifier == '${MACOS_BUNDLE_ID}'`;
  const output = await runTool(MDFIND_BIN, [query]);
  if (output === undefined) return undefined;
  const bundles = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".app"));

  for (const bundle of bundles) {
    const plist = join(bundle, "Contents", "Info.plist");
    if (!isFile(plist)) continue;
    const identifier = (
      await runTool(PLUTIL_BIN, ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist])
    )?.trim();
    if (identifier !== MACOS_BUNDLE_ID) continue;
    // The inner executable is what accepts ELECTRON_RUN_AS_NODE; the .app
    // wrapper would launch the GUI instead.
    const executable = join(bundle, "Contents", "MacOS", "Electron");
    if (isFile(executable)) return executable;
  }
  return undefined;
}

/**
 * Locate WorkBuddy's Electron binary on this platform.
 *
 * Windows and macOS have real discovery; Linux has none, matching the
 * upstream provider, which also reports `discovery: none` there. Callers
 * surface that as an explanatory error rather than a crash.
 *
 * @returns {Promise<string|undefined>} an existing executable path
 */
async function discoverElectron() {
  if (process.platform === "darwin") return discoverFromSpotlight();
  if (process.platform === "win32") return discoverFromRegistry();
  return undefined;
}

/** Validate the helper's printed payload and return the base64 secret. */
function parsePayload(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  if (parsed.version !== 1) return undefined;
  const secret = parsed.atRestSecretKey;
  if (typeof secret !== "string" || secret === "") return undefined;
  const decoded = Buffer.from(secret, "base64");
  if (decoded.length !== 32) return undefined;
  // Re-encoding must round-trip, or the value is not canonical base64.
  if (decoded.toString("base64") !== secret) return undefined;
  if (decoded.every((byte) => byte === 0)) return undefined;
  return secret;
}

/** Spawn the binary and capture its printed payload. */
function spawnHelper(electronPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      electronPath,
      ["-e", HELPER_SCRIPT],
      {
        timeout: timeoutMs,
        maxBuffer: 1048576,
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
      (error, stdout) => {
        if (error !== null && error !== undefined) {
          reject(
            new Error(
              `the WorkBuddy key helper (${electronPath}) ${
                error.killed === true
                  ? `timed out after ${String(timeoutMs)}ms`
                  : error.code !== undefined
                    ? `exited with code ${String(error.code)}`
                    : "could not be started"
              }`,
            ),
          );
          return;
        }
        const output = stdout.trim();
        if (output === "") {
          reject(new Error(`the WorkBuddy key helper (${electronPath}) produced no payload`));
          return;
        }
        resolve(output);
      },
    );
  });
}

/**
 * Create a key provider for `WorkBuddyCredentialStore`'s `keyProvider` option.
 *
 * @param {{ electronPath?: string, timeoutMs?: number }} [options]
 * @returns {{ protectorKeyFor: (requested: readonly string[]) => Promise<Buffer>, helperPath: () => string | undefined }}
 */
export function createAtRestKeyProvider(options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  /** Resolved binary path; cleared when it turns out to be unusable. */
  let resolvedPath;
  /** Structurally resolved key, cached per process like the upstream one. */
  let cached;

  const explicitPath =
    typeof options.electronPath === "string" && options.electronPath !== ""
      ? options.electronPath
      : typeof process.env.WORKBUDDY_ELECTRON_BIN === "string" && process.env.WORKBUDDY_ELECTRON_BIN.trim() !== ""
        ? process.env.WORKBUDDY_ELECTRON_BIN.trim()
        : undefined;

  /** Resolve the binary: explicit, then platform default, then discovery. */
  async function resolveElectronPath() {
    if (explicitPath !== undefined) {
      if (!isFile(explicitPath)) {
        throw new Error(
          `the configured WorkBuddy Electron binary is not available at ${explicitPath}; ` +
            "check WORKBUDDY_ELECTRON_BIN or unset it to let the plugin look for the app itself",
        );
      }
      return explicitPath;
    }
    if (resolvedPath !== undefined && isFile(resolvedPath)) return resolvedPath;
    const fallback = defaultElectronPath();
    if (fallback !== undefined && isFile(fallback)) {
      resolvedPath = fallback;
      return fallback;
    }
    const discovered = await discoverElectron();
    if (discovered === undefined) {
      // Linux has no discovery at all, matching the upstream provider, so let
      // that case say so instead of sending a user looking for a Windows path.
      throw new Error(
        process.platform === "linux"
          ? "decrypting WorkBuddy's stored credential is only supported on Windows and macOS; " +
              "on Linux, either sign in to a WorkBuddy build that stores the token unencrypted, " +
              "or set WORKBUDDY_AUTH_FILE to a plaintext credential file"
          : "no WorkBuddy Electron binary could be found; install WorkBuddy, or set " +
              "WORKBUDDY_ELECTRON_BIN to its executable",
      );
    }
    resolvedPath = discovered;
    return discovered;
  }

  return {
    /** The binary that would be spawned, for diagnostics. Never triggers I/O. */
    helperPath() {
      if (explicitPath !== undefined) return explicitPath;
      return resolvedPath ?? defaultElectronPath();
    },

    /**
     * The protector key for one of the requested envelope key ids.
     *
     * @param {readonly string[]} requested envelope key ids
     * @returns {Promise<Buffer>} the AES key
     */
    async protectorKeyFor(requested) {
      if (requested.length === 0) {
        throw new Error("encrypted desktop credential carries no key ids");
      }
      if (cached !== undefined && requested.includes(cached.keyId)) return cached.key;
      const electronPath = await resolveElectronPath();
      const payload = await spawnHelper(electronPath, timeoutMs);
      const secret = parsePayload(payload);
      if (secret === undefined) {
        throw new Error(
          "WorkBuddy key helper returned an unusable at-rest payload " +
            "(expected {version:1, atRestSecretKey})",
        );
      }
      const key = createHash("sha256").update(secret, "utf8").digest();
      const keyId = createHash("sha256").update(key).digest("hex").slice(0, 16);
      cached = { key, keyId };
      if (!requested.includes(keyId)) {
        throw new Error(
          `WorkBuddy's current at-rest key (id ${keyId}) does not match the credential's envelope ` +
            `(id ${requested.join(" or ")}); the desktop credential was sealed by a different ` +
            "WorkBuddy installation",
        );
      }
      return key;
    },
  };
}

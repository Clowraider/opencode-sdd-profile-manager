import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { createLogger } from "./logger";
import { resolvePaths, ensureProfilesDir } from "./config";
import { readProfileData, writeProfileData, listProfileFiles, sanitizeProfileName } from "./profiles";
import { withFileLock } from "./utils";
import type { OrchestratorPolicy } from "./orchestrator";
import type {
  ProfileData,
  SingleProfileExportPayload,
  BundleProfileExportPayload,
  ImportConflictResolution,
  ImportProfilesResult,
  ParsedProfileImport,
} from "./types";

const log = createLogger("import-export");

function stripJsonBom(raw: string): string {
  return raw.replace(/^\uFEFF/, "");
}

function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.tmp-${randomBytes(4).toString("hex")}`;
  let renameCompleted = false;

  try {
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, filePath);
    renameCompleted = true;
  } catch {
    // Fallback for filesystems that fail on renameSync over existing files (e.g. Windows cross-device or lock quirks)
    fs.copyFileSync(tmpPath, filePath);
    renameCompleted = true;
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignored
    }
  } finally {
    if (!renameCompleted) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch (e) {
        log.warn(`atomicWriteFile: failed to remove temporary file ${tmpPath}`, e);
      }
    }
  }
}

/**
 * Validates that an unknown object structurally conforms to ProfileData.
 */
export function validateProfileData(data: unknown): ProfileData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid profile data: expected an object");
  }

  const record = data as Record<string, unknown>;

  if (!record.models || typeof record.models !== "object" || Array.isArray(record.models)) {
    throw new Error("Invalid profile data: 'models' must be a key-value object");
  }

  const models: Record<string, string> = {};
  for (const [key, val] of Object.entries(record.models as Record<string, unknown>)) {
    if (typeof val !== "string") {
      throw new Error(`Invalid profile data: model for '${key}' must be a string`);
    }
    models[key] = val;
  }

  let fallback: Record<string, string> | undefined;
  if (record.fallback !== undefined) {
    if (typeof record.fallback !== "object" || record.fallback === null || Array.isArray(record.fallback)) {
      throw new Error("Invalid profile data: 'fallback' must be a key-value object");
    }
    fallback = {};
    for (const [key, val] of Object.entries(record.fallback as Record<string, unknown>)) {
      if (typeof val !== "string") {
        throw new Error(`Invalid profile data: fallback model for '${key}' must be a string`);
      }
      fallback[key] = val;
    }
  }

  let configs: ProfileData["configs"] | undefined;
  if (record.configs !== undefined) {
    if (typeof record.configs !== "object" || record.configs === null || Array.isArray(record.configs)) {
      throw new Error("Invalid profile data: 'configs' must be a key-value object");
    }
    configs = {};
    for (const [agentName, agentCfg] of Object.entries(record.configs as Record<string, unknown>)) {
      if (!agentCfg || typeof agentCfg !== "object" || Array.isArray(agentCfg)) {
        throw new Error(`Invalid profile data: config for '${agentName}' must be an object`);
      }
      const cfgObj = agentCfg as Record<string, unknown>;
      configs[agentName] = typeof cfgObj.reasoningEffort === "string"
        ? { reasoningEffort: cfgObj.reasoningEffort }
        : {};
    }
  }

  return {
    models,
    ...(fallback ? { fallback } : {}),
    ...(configs ? { configs } : {}),
  };
}

/**
 * Builds a typed export payload for a single profile.
 */
export function buildSingleProfileExport(name: string, data: ProfileData): SingleProfileExportPayload {
  const sanitizedName = sanitizeProfileName(name);
  const validated = validateProfileData(data);
  return {
    format: "opencode-sdd-profile",
    version: 1,
    type: "single",
    exportedAt: new Date().toISOString(),
    name: sanitizedName,
    data: validated,
  };
}

/**
 * Builds a typed export payload for all profiles (bundle).
 */
export function buildBundleProfilesExport(
  profiles: Record<string, ProfileData>,
  activeProfile?: string,
): BundleProfileExportPayload {
  const validatedProfiles: Record<string, ProfileData> = {};
  for (const [name, data] of Object.entries(profiles)) {
    const sanitizedName = sanitizeProfileName(name);
    validatedProfiles[sanitizedName] = validateProfileData(data);
  }

  return {
    format: "opencode-sdd-profile-bundle",
    version: 1,
    type: "bundle",
    exportedAt: new Date().toISOString(),
    ...(activeProfile ? { activeProfile: sanitizeProfileName(activeProfile) } : {}),
    profiles: validatedProfiles,
  };
}

/**
 * Exports a single profile to a file.
 */
export function exportProfileToFile(targetPath: string, name: string, data: ProfileData): void {
  const payload = buildSingleProfileExport(name, data);
  const content = JSON.stringify(payload, null, 2);
  withFileLock(targetPath, () => {
    atomicWriteFile(targetPath, content);
  });
}

/**
 * Exports all existing profiles to a bundle file.
 */
export function exportAllProfilesToFile(
  targetPath: string,
  activeProfile?: string,
): { count: number; filePath: string } {
  const { profilesDir } = resolvePaths();
  ensureProfilesDir();

  const files = listProfileFiles();
  const profilesMap: Record<string, ProfileData> = {};

  for (const file of files) {
    const profileName = file.replace(/\.json$/i, "");
    const filePath = path.join(profilesDir, file);
    try {
      const data = readProfileData(filePath);
      profilesMap[profileName] = data;
    } catch (error) {
      log.warn(`exportAllProfilesToFile: skipping unreadable profile ${file}`, error);
    }
  }

  const payload = buildBundleProfilesExport(profilesMap, activeProfile);
  const content = JSON.stringify(payload, null, 2);

  withFileLock(targetPath, () => {
    atomicWriteFile(targetPath, content);
  });

  return {
    count: Object.keys(profilesMap).length,
    filePath: targetPath,
  };
}

/**
 * Parses and validates an import JSON string. Supports both single profile exports,
 * bundle exports, and raw profile JSON formats.
 */
export function parseAndValidateProfileImport(rawJson: string): ParsedProfileImport {
  const clean = stripJsonBom(rawJson).trim();
  if (!clean) {
    throw new Error("Import payload is empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch (error) {
    throw new Error(`Invalid JSON in import payload: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid import payload: expected JSON object at root");
  }

  const root = parsed as Record<string, unknown>;

  // Case 1: Typed single profile export
  if (root.format === "opencode-sdd-profile" || root.type === "single") {
    const name = typeof root.name === "string" ? root.name : undefined;
    const data = validateProfileData(root.data ?? root);
    return {
      type: "single",
      ...(name ? { name } : {}),
      data,
    };
  }

  // Case 2: Typed bundle profile export
  if (root.format === "opencode-sdd-profile-bundle" || root.type === "bundle" || (root.profiles && typeof root.profiles === "object" && !Array.isArray(root.profiles))) {
    const rawProfiles = (root.profiles ?? {}) as Record<string, unknown>;
    const profiles: Record<string, ProfileData> = {};

    for (const [name, profilePayload] of Object.entries(rawProfiles)) {
      try {
        const sanitized = sanitizeProfileName(name);
        profiles[sanitized] = validateProfileData(profilePayload);
      } catch (err) {
        log.warn(`parseAndValidateProfileImport: skipping invalid profile in bundle '${name}'`, err);
      }
    }

    if (Object.keys(profiles).length === 0) {
      throw new Error("Bundle contains no valid profile entries");
    }

    const activeProfile = typeof root.activeProfile === "string" ? root.activeProfile : undefined;
    return {
      type: "bundle",
      ...(activeProfile ? { activeProfile } : {}),
      profiles,
    };
  }

  // Case 3: Raw ProfileData object (has 'models' key)
  if (root.models && typeof root.models === "object" && !Array.isArray(root.models)) {
    const data = validateProfileData(root);
    return {
      type: "single",
      data,
    };
  }

  // Case 4: Map of profiles { "Profile1": { models: {...} }, "Profile2": { models: {...} } }
  const potentialProfiles: Record<string, ProfileData> = {};
  for (const [name, potentialData] of Object.entries(root)) {
    if (potentialData && typeof potentialData === "object" && !Array.isArray(potentialData)) {
      const rec = potentialData as Record<string, unknown>;
      if (rec.models && typeof rec.models === "object" && !Array.isArray(rec.models)) {
        try {
          potentialProfiles[sanitizeProfileName(name)] = validateProfileData(rec);
        } catch {
          // not a valid profile
        }
      }
    }
  }

  if (Object.keys(potentialProfiles).length > 0) {
    return {
      type: "bundle",
      profiles: potentialProfiles,
    };
  }

  throw new Error("Unrecognized profile import format: missing 'models' or 'profiles' structure");
}

/**
 * Inspects a profile import file and returns summary metadata.
 */
export function inspectProfileImport(filePath: string): {
  type: "single" | "bundle";
  profileCount: number;
  profileNames: string[];
  activeProfile?: string;
} {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Import file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = parseAndValidateProfileImport(raw);

  if (parsed.type === "single") {
    const fallbackName = path.basename(filePath).replace(/\.json$/i, "");
    const name = parsed.name || fallbackName;
    return {
      type: "single",
      profileCount: 1,
      profileNames: [name],
    };
  }

  return {
    type: "bundle",
    profileCount: Object.keys(parsed.profiles).length,
    profileNames: Object.keys(parsed.profiles),
    ...(parsed.activeProfile ? { activeProfile: parsed.activeProfile } : {}),
  };
}

export interface ImportProfilesOptions {
  conflictResolution?: ImportConflictResolution;
  targetProfileName?: string;
  policy?: OrchestratorPolicy;
}

/**
 * Imports profiles from a file into the OpenCode profiles directory.
 */
export function importProfilesFromFile(
  filePath: string,
  options: ImportProfilesOptions = {},
): ImportProfilesResult {
  const { conflictResolution = "overwrite", targetProfileName, policy } = options;
  const { profilesDir } = resolvePaths();
  ensureProfilesDir();

  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = parseAndValidateProfileImport(raw);

  const imported: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];
  const errors: string[] = [];

  const profilesToImport: Array<{ name: string; data: ProfileData }> = [];

  if (parsed.type === "single") {
    const chosenName = targetProfileName?.trim() || parsed.name || path.basename(filePath).replace(/\.json$/i, "");
    try {
      const sanitized = sanitizeProfileName(chosenName);
      profilesToImport.push({ name: sanitized, data: parsed.data });
    } catch (err: any) {
      errors.push(`Invalid profile name '${chosenName}': ${err.message}`);
    }
  } else {
    for (const [name, data] of Object.entries(parsed.profiles)) {
      profilesToImport.push({ name, data });
    }
  }

  for (const { name, data } of profilesToImport) {
    const targetFile = path.join(profilesDir, `${name}.json`);
    const exists = fs.existsSync(targetFile);

    if (exists && conflictResolution === "skip") {
      skipped.push(name);
      continue;
    }

    try {
      writeProfileData(targetFile, data, policy);
      if (exists) {
        overwritten.push(name);
      } else {
        imported.push(name);
      }
    } catch (err: any) {
      const msg = `Failed to save profile '${name}': ${err.message}`;
      log.warn(msg, err);
      errors.push(msg);
    }
  }

  return {
    success: errors.length === 0 && (imported.length > 0 || overwritten.length > 0 || skipped.length > 0),
    imported,
    skipped,
    overwritten,
    ...(parsed.type === "bundle" && parsed.activeProfile ? { activeProfile: parsed.activeProfile } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

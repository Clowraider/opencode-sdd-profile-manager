import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  validateProfileData,
  buildSingleProfileExport,
  buildBundleProfilesExport,
  parseAndValidateProfileImport,
  exportProfileToFile,
  exportAllProfilesToFile,
  inspectProfileImport,
  importProfilesFromFile,
} from "./import-export";
import type { ProfileData } from "./types";

describe("import-export logic", () => {
  let tempDir: string;
  let fakeConfigRoot: string;
  let fakeProfilesDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-import-export-test-"));
    fakeConfigRoot = path.join(tempDir, "opencode");
    fakeProfilesDir = path.join(fakeConfigRoot, "profiles");
    fs.mkdirSync(fakeProfilesDir, { recursive: true });

    // Mock resolvePaths to use our fake directory
    vi.stubEnv("XDG_CONFIG_HOME", tempDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  const sampleProfileA: ProfileData = {
    models: {
      "gentle-orchestrator": "anthropic/claude-3-7-sonnet",
      "sdd-apply": "openai/o3-mini",
    },
    fallback: {
      "sdd-apply": "anthropic/claude-3-5-haiku",
    },
    configs: {
      "sdd-apply": { reasoningEffort: "high" },
    },
  };

  const sampleProfileB: ProfileData = {
    models: {
      "gentle-orchestrator": "deepseek/deepseek-r1",
      "sdd-apply": "deepseek/deepseek-chat",
    },
  };

  describe("validateProfileData", () => {
    it("accepts valid ProfileData with models, fallback, configs", () => {
      const validated = validateProfileData(sampleProfileA);
      expect(validated.models).toEqual(sampleProfileA.models);
      expect(validated.fallback).toEqual(sampleProfileA.fallback);
      expect(validated.configs).toEqual(sampleProfileA.configs);
    });

    it("accepts valid ProfileData with only models", () => {
      const validated = validateProfileData(sampleProfileB);
      expect(validated.models).toEqual(sampleProfileB.models);
      expect(validated.fallback).toBeUndefined();
      expect(validated.configs).toBeUndefined();
    });

    it("throws if input is not an object or is array", () => {
      expect(() => validateProfileData(null)).toThrow("Invalid profile data");
      expect(() => validateProfileData([])).toThrow("Invalid profile data");
      expect(() => validateProfileData("string")).toThrow("Invalid profile data");
    });

    it("throws if models is missing or not a key-value object", () => {
      expect(() => validateProfileData({})).toThrow("'models' must be a key-value object");
      expect(() => validateProfileData({ models: "not-an-object" })).toThrow("'models' must be a key-value object");
      expect(() => validateProfileData({ models: { agent1: 123 } })).toThrow("must be a string");
    });

    it("throws if fallback has non-string values", () => {
      expect(() => validateProfileData({ models: {}, fallback: { agent: 123 } })).toThrow("fallback model for 'agent' must be a string");
    });

    it("throws if configs has non-object values", () => {
      expect(() => validateProfileData({ models: {}, configs: { agent: "wrong" } })).toThrow("config for 'agent' must be an object");
    });
  });

  describe("buildSingleProfileExport & buildBundleProfilesExport", () => {
    it("builds a single profile payload with correct metadata", () => {
      const payload = buildSingleProfileExport("Production Profile", sampleProfileA);
      expect(payload.format).toBe("opencode-sdd-profile");
      expect(payload.type).toBe("single");
      expect(payload.version).toBe(1);
      expect(payload.name).toBe("Production Profile");
      expect(payload.data.models).toEqual(sampleProfileA.models);
      expect(payload.exportedAt).toBeDefined();
    });

    it("sanitizes profile name during single export", () => {
      expect(() => buildSingleProfileExport("../../unsafe", sampleProfileA)).toThrow("unsafe characters");
    });

    it("builds a bundle profile payload with multiple profiles", () => {
      const payload = buildBundleProfilesExport(
        { "Profile-A": sampleProfileA, "Profile-B": sampleProfileB },
        "Profile-A",
      );
      expect(payload.format).toBe("opencode-sdd-profile-bundle");
      expect(payload.type).toBe("bundle");
      expect(payload.version).toBe(1);
      expect(payload.activeProfile).toBe("Profile-A");
      expect(Object.keys(payload.profiles)).toEqual(["Profile-A", "Profile-B"]);
    });
  });

  describe("parseAndValidateProfileImport", () => {
    it("parses typed single profile export", () => {
      const exportPayload = buildSingleProfileExport("Custom", sampleProfileA);
      const parsed = parseAndValidateProfileImport(JSON.stringify(exportPayload));

      expect(parsed.type).toBe("single");
      if (parsed.type === "single") {
        expect(parsed.name).toBe("Custom");
        expect(parsed.data.models).toEqual(sampleProfileA.models);
      }
    });

    it("parses typed bundle profile export", () => {
      const exportPayload = buildBundleProfilesExport({ "A": sampleProfileA, "B": sampleProfileB }, "A");
      const parsed = parseAndValidateProfileImport(JSON.stringify(exportPayload));

      expect(parsed.type).toBe("bundle");
      if (parsed.type === "bundle") {
        expect(parsed.activeProfile).toBe("A");
        expect(Object.keys(parsed.profiles)).toEqual(["A", "B"]);
      }
    });

    it("parses raw single profile JSON (direct models object)", () => {
      const rawJson = JSON.stringify(sampleProfileA);
      const parsed = parseAndValidateProfileImport(rawJson);

      expect(parsed.type).toBe("single");
      if (parsed.type === "single") {
        expect(parsed.data.models).toEqual(sampleProfileA.models);
      }
    });

    it("parses map of profiles JSON", () => {
      const rawJson = JSON.stringify({
        "ProfileOne": sampleProfileA,
        "ProfileTwo": sampleProfileB,
      });
      const parsed = parseAndValidateProfileImport(rawJson);

      expect(parsed.type).toBe("bundle");
      if (parsed.type === "bundle") {
        expect(Object.keys(parsed.profiles)).toEqual(["ProfileOne", "ProfileTwo"]);
      }
    });

    it("handles UTF-8 BOM smoothly", () => {
      const exportPayload = buildSingleProfileExport("BOM-Test", sampleProfileA);
      const withBom = "\uFEFF" + JSON.stringify(exportPayload);
      const parsed = parseAndValidateProfileImport(withBom);

      expect(parsed.type).toBe("single");
      if (parsed.type === "single") {
        expect(parsed.name).toBe("BOM-Test");
      }
    });

    it("throws on empty or invalid JSON", () => {
      expect(() => parseAndValidateProfileImport("")).toThrow("empty");
      expect(() => parseAndValidateProfileImport("   ")).toThrow("empty");
      expect(() => parseAndValidateProfileImport("{ invalid json }")).toThrow("Invalid JSON");
      expect(() => parseAndValidateProfileImport("[]")).toThrow("expected JSON object at root");
      expect(() => parseAndValidateProfileImport(JSON.stringify({ someKey: 123 }))).toThrow("Unrecognized profile import format");
    });
  });

  describe("exportProfileToFile & exportAllProfilesToFile", () => {
    it("writes a single profile export file atomically", () => {
      const dest = path.join(tempDir, "export-single.json");
      exportProfileToFile(dest, "MyProfile", sampleProfileA);

      expect(fs.existsSync(dest)).toBe(true);
      const content = JSON.parse(fs.readFileSync(dest, "utf-8"));
      expect(content.format).toBe("opencode-sdd-profile");
      expect(content.name).toBe("MyProfile");
      expect(content.data.models).toEqual(sampleProfileA.models);
    });

    it("exports all profiles in profiles directory to a bundle file", () => {
      // Save 2 profiles in fake profiles directory
      fs.writeFileSync(path.join(fakeProfilesDir, "Dev.json"), JSON.stringify(sampleProfileA));
      fs.writeFileSync(path.join(fakeProfilesDir, "Prod.json"), JSON.stringify(sampleProfileB));

      const dest = path.join(tempDir, "bundle.json");
      const result = exportAllProfilesToFile(dest, "Dev");

      expect(result.count).toBe(2);
      expect(fs.existsSync(dest)).toBe(true);

      const content = JSON.parse(fs.readFileSync(dest, "utf-8"));
      expect(content.format).toBe("opencode-sdd-profile-bundle");
      expect(content.activeProfile).toBe("Dev");
      expect(content.profiles["Dev"].models).toEqual(sampleProfileA.models);
      expect(content.profiles["Prod"].models).toEqual(sampleProfileB.models);
    });
  });

  describe("inspectProfileImport", () => {
    it("inspects a single profile file", () => {
      const file = path.join(tempDir, "single.json");
      exportProfileToFile(file, "Alpha", sampleProfileA);

      const summary = inspectProfileImport(file);
      expect(summary.type).toBe("single");
      expect(summary.profileCount).toBe(1);
      expect(summary.profileNames).toEqual(["Alpha"]);
    });

    it("inspects a bundle file", () => {
      const file = path.join(tempDir, "bundle.json");
      const payload = buildBundleProfilesExport({ "X": sampleProfileA, "Y": sampleProfileB }, "X");
      fs.writeFileSync(file, JSON.stringify(payload));

      const summary = inspectProfileImport(file);
      expect(summary.type).toBe("bundle");
      expect(summary.profileCount).toBe(2);
      expect(summary.profileNames).toEqual(["X", "Y"]);
      expect(summary.activeProfile).toBe("X");
    });

    it("throws if file does not exist", () => {
      expect(() => inspectProfileImport(path.join(tempDir, "missing.json"))).toThrow("not found");
    });
  });

  describe("importProfilesFromFile", () => {
    it("imports a single profile into the profiles directory", () => {
      const sourceFile = path.join(tempDir, "source-single.json");
      exportProfileToFile(sourceFile, "ImportedProfile", sampleProfileA);

      const result = importProfilesFromFile(sourceFile);
      expect(result.success).toBe(true);
      expect(result.imported).toEqual(["ImportedProfile"]);
      expect(result.overwritten).toEqual([]);
      expect(result.skipped).toEqual([]);

      const targetPath = path.join(fakeProfilesDir, "ImportedProfile.json");
      expect(fs.existsSync(targetPath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
      expect(saved.models).toEqual(sampleProfileA.models);
    });

    it("respects targetProfileName override for single profile import", () => {
      const sourceFile = path.join(tempDir, "source-single.json");
      exportProfileToFile(sourceFile, "OriginalName", sampleProfileA);

      const result = importProfilesFromFile(sourceFile, { targetProfileName: "RenamedProfile" });
      expect(result.success).toBe(true);
      expect(result.imported).toEqual(["RenamedProfile"]);

      const targetPath = path.join(fakeProfilesDir, "RenamedProfile.json");
      expect(fs.existsSync(targetPath)).toBe(true);
    });

    it("handles conflict resolution: overwrite vs skip", () => {
      // First create existing profile
      const targetPath = path.join(fakeProfilesDir, "Existing.json");
      fs.writeFileSync(targetPath, JSON.stringify(sampleProfileB));

      const sourceFile = path.join(tempDir, "source.json");
      exportProfileToFile(sourceFile, "Existing", sampleProfileA);

      // 1. Skip mode
      const skipResult = importProfilesFromFile(sourceFile, { conflictResolution: "skip" });
      expect(skipResult.skipped).toEqual(["Existing"]);
      expect(skipResult.overwritten).toEqual([]);
      expect(skipResult.imported).toEqual([]);
      // File still has sampleProfileB
      const stillB = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
      expect(stillB.models).toEqual(sampleProfileB.models);

      // 2. Overwrite mode
      const overwriteResult = importProfilesFromFile(sourceFile, { conflictResolution: "overwrite" });
      expect(overwriteResult.overwritten).toEqual(["Existing"]);
      expect(overwriteResult.skipped).toEqual([]);
      expect(overwriteResult.imported).toEqual([]);
      // File now has sampleProfileA
      const nowA = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
      expect(nowA.models).toEqual(sampleProfileA.models);
    });

    it("imports a bundle with multiple profiles", () => {
      const bundleFile = path.join(tempDir, "multi-bundle.json");
      const payload = buildBundleProfilesExport(
        { "Tier1": sampleProfileA, "Tier2": sampleProfileB },
        "Tier1",
      );
      fs.writeFileSync(bundleFile, JSON.stringify(payload));

      const result = importProfilesFromFile(bundleFile);
      expect(result.success).toBe(true);
      expect(result.imported).toContain("Tier1");
      expect(result.imported).toContain("Tier2");
      expect(result.activeProfile).toBe("Tier1");

      expect(fs.existsSync(path.join(fakeProfilesDir, "Tier1.json"))).toBe(true);
      expect(fs.existsSync(path.join(fakeProfilesDir, "Tier2.json"))).toBe(true);
    });
  });
});

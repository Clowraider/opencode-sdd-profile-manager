import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  showProfilesMenu,
  showImportExportMenu,
  showExportAllProfilesPrompt,
  showExportSingleProfilePicker,
  showExportSingleProfilePrompt,
  showImportProfilesPrompt,
  showConfirmImportDialog,
  showExportProfile,
  createProfileDetailDialogProps,
  buildProfileDetailHubOptions,
  registerDialogCallbacks,
} from "./dialogs";
import * as importExportModule from "./import-export";
import * as profilesModule from "./profiles";

describe("TUI dialogs: Import/Export flows", () => {
  let capturedComponent: any;
  let mockApi: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    capturedComponent = null;

    mockApi = {
      ui: {
        dialog: {
          replace: vi.fn((renderFn: () => any) => {
            capturedComponent = renderFn();
          }),
          clear: vi.fn(),
          setSize: vi.fn(),
        },
        DialogSelect: (props: any) => ({ type: "DialogSelect", props }),
        DialogPrompt: (props: any) => ({ type: "DialogPrompt", props }),
        DialogAlert: (props: any) => ({ type: "DialogAlert", props }),
        toast: vi.fn(),
      },
      state: {
        provider: [],
        config: {
          agent: {},
        },
      },
    };

    registerDialogCallbacks({
      showProfilesMenu: vi.fn(),
      showProfileList: vi.fn(),
      showProfileDetail: vi.fn(),
      showProjectMemoriesMenu: vi.fn(),
    });
  });

  it("showProfilesMenu includes Import/Export option and navigates to showImportExportMenu", () => {
    showProfilesMenu(mockApi);

    expect(capturedComponent.type).toBe("DialogSelect");
    const options = capturedComponent.props.options;
    const importExportOpt = options.find((opt: any) => opt.value === "import_export");
    expect(importExportOpt).toBeDefined();
    expect(importExportOpt.title).toContain("Importar / Exportar");

    // Select import_export option
    capturedComponent.props.onSelect(importExportOpt);
    expect(capturedComponent.props.title).toBe("Importar / Exportar perfiles SDD");
  });

  it("showImportExportMenu renders options for export_all, export_single, import, and back", () => {
    showImportExportMenu(mockApi);

    expect(capturedComponent.type).toBe("DialogSelect");
    const options = capturedComponent.props.options;
    const values = options.map((opt: any) => opt.value);
    expect(values).toContain("export_all");
    expect(values).toContain("export_single");
    expect(values).toContain("import");
    expect(values).toContain("__back__");
  });

  it("showExportAllProfilesPrompt prompts for destination and exports all profiles", () => {
    const exportSpy = vi.spyOn(importExportModule, "exportAllProfilesToFile").mockReturnValue({
      count: 3,
      filePath: "/mock/bundle.json",
    });

    showExportAllProfilesPrompt(mockApi);
    expect(capturedComponent.type).toBe("DialogPrompt");

    // Confirm export
    capturedComponent.props.onConfirm("/mock/bundle.json");

    expect(exportSpy).toHaveBeenCalled();
    expect(mockApi.ui.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Exportación exitosa",
        message: expect.stringContaining("3 perfiles exportados"),
        variant: "success",
      }),
    );
  });

  it("showExportSingleProfilePicker shows toast if no profiles exist", () => {
    vi.spyOn(profilesModule, "listProfileFiles").mockReturnValue([]);

    showExportSingleProfilePicker(mockApi);

    expect(mockApi.ui.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "No hay perfiles guardados para exportar",
      }),
    );
  });

  it("showExportSingleProfilePicker lists profiles and opens prompt on selection", () => {
    vi.spyOn(profilesModule, "listProfileFiles").mockReturnValue(["Dev.json", "Prod.json"]);

    showExportSingleProfilePicker(mockApi);
    expect(capturedComponent.type).toBe("DialogSelect");
    expect(capturedComponent.props.options.some((opt: any) => opt.value === "Dev")).toBe(true);

    // Select Dev
    capturedComponent.props.onSelect({ value: "Dev" });
    expect(capturedComponent.type).toBe("DialogPrompt");
    expect(capturedComponent.props.title).toContain("Dev");
  });

  it("showExportSingleProfilePrompt exports single profile to destination", () => {
    vi.spyOn(profilesModule, "readProfileData").mockReturnValue({
      models: { "sdd-apply": "openai/gpt-4" },
    });
    const exportSpy = vi.spyOn(importExportModule, "exportProfileToFile").mockImplementation(() => {});

    showExportSingleProfilePrompt(mockApi, "Dev");
    expect(capturedComponent.type).toBe("DialogPrompt");

    capturedComponent.props.onConfirm("./dev-out.json");

    expect(exportSpy).toHaveBeenCalledWith(
      expect.stringContaining("dev-out.json"),
      "Dev",
      expect.anything(),
    );
    expect(mockApi.ui.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Exportación exitosa",
        variant: "success",
      }),
    );
  });

  it("showImportProfilesPrompt inspects file and triggers showConfirmImportDialog", () => {
    const inspectSpy = vi.spyOn(importExportModule, "inspectProfileImport").mockReturnValue({
      type: "bundle",
      profileCount: 2,
      profileNames: ["A", "B"],
    });

    showImportProfilesPrompt(mockApi);
    expect(capturedComponent.type).toBe("DialogPrompt");

    capturedComponent.props.onConfirm("/mock/import.json");

    expect(inspectSpy).toHaveBeenCalled();
    expect(capturedComponent.type).toBe("DialogSelect");
    expect(capturedComponent.props.title).toContain("Importar Bundle (2 perfiles)");
  });

  it("showConfirmImportDialog imports with overwrite and triggers success toast", () => {
    const importSpy = vi.spyOn(importExportModule, "importProfilesFromFile").mockReturnValue({
      success: true,
      imported: ["NewProfile"],
      overwritten: ["OldProfile"],
      skipped: [],
    });

    showConfirmImportDialog(mockApi, "/mock/bundle.json", {
      type: "bundle",
      profileCount: 2,
      profileNames: ["NewProfile", "OldProfile"],
    });

    expect(capturedComponent.type).toBe("DialogSelect");

    // Select overwrite
    capturedComponent.props.onSelect({ value: "overwrite" });

    expect(importSpy).toHaveBeenCalledWith("/mock/bundle.json", { conflictResolution: "overwrite" });
    expect(mockApi.ui.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Importación exitosa",
        message: "1 importados, 1 sobrescritos",
        variant: "success",
      }),
    );
  });

  it("buildProfileDetailHubOptions includes __export_profile__ and createProfileDetailDialogProps routes to showExportProfile", () => {
    const profileOpt = { title: "CustomProfile", value: "CustomProfile.json" };
    const profileData = { models: { "sdd-apply": "model-1" } };
    const options = buildProfileDetailHubOptions(mockApi, profileOpt, profileData);

    const exportOpt = options.find((opt) => opt.value === "__export_profile__");
    expect(exportOpt).toBeDefined();
    expect(exportOpt?.title).toContain("Exportar perfil");

    const mockShowExport = vi.fn();
    const props = createProfileDetailDialogProps(
      mockApi,
      profileOpt,
      "/mock/CustomProfile.json",
      profileData,
      { sddAgents: [], fallbackAgents: [] },
      { showExportProfile: mockShowExport },
    );

    props.onSelect({ value: "__export_profile__" });
    expect(mockShowExport).toHaveBeenCalledWith(mockApi, profileOpt);
  });

  it("showExportProfile exports the profile directly from detail hub", () => {
    vi.spyOn(profilesModule, "readProfileData").mockReturnValue({
      models: { "sdd-apply": "model-1" },
    });
    const exportSpy = vi.spyOn(importExportModule, "exportProfileToFile").mockImplementation(() => {});

    const profileOpt = { title: "DetailProfile", value: "DetailProfile.json" };
    showExportProfile(mockApi, profileOpt);

    expect(capturedComponent.type).toBe("DialogPrompt");
    expect(capturedComponent.props.title).toContain("DetailProfile");

    capturedComponent.props.onConfirm("./exported.json");
    expect(exportSpy).toHaveBeenCalled();
    expect(mockApi.ui.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Exportación exitosa",
        variant: "success",
      }),
    );
  });
});

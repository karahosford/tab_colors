import { App, FileView, Menu, Modal, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

interface PresetColor {
  name: string;
  color: string;
}

interface TabColorsSettings {
  fileColors: Record<string, string>;
  presetColors: PresetColor[];
}

const DEFAULT_PRESET_COLORS: PresetColor[] = [
  { name: "Sky", color: "#3aa6ff" },
  { name: "Leaf", color: "#44cf6c" },
  { name: "Amber", color: "#ffb84d" },
  { name: "Coral", color: "#ff6b6b" },
  { name: "Violet", color: "#b07cff" },
  { name: "Teal", color: "#4ddac6" }
];

const DEFAULT_SETTINGS: TabColorsSettings = {
  fileColors: {},
  presetColors: [...DEFAULT_PRESET_COLORS]
};

class ColorPickerModal extends Modal {
  private result: string | null = null;
  private selectedColor: string;
  private readonly onSubmit: (color: string | null) => void;
  private readonly presetColors: PresetColor[];

  constructor(plugin: TabColorsPlugin, initialColor: string | null, presetColors: PresetColor[], onSubmit: (color: string | null) => void) {
    super(plugin.app);
    this.onSubmit = onSubmit;
    this.presetColors = presetColors;
    this.selectedColor = initialColor ?? "#3aa6ff";
    this.setTitle("Set Tab Color");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const swatchWrap = contentEl.createDiv({ cls: "tab-colors-swatch-grid" });
    for (const preset of this.presetColors) {
      const swatch = swatchWrap.createEl("button", {
        cls: "tab-colors-swatch",
        attr: {
          type: "button",
          title: `${preset.name} (${preset.color})`,
          "aria-label": `Use preset ${preset.name}`
        }
      });
      swatch.style.backgroundColor = preset.color;
      swatch.addEventListener("click", () => {
        this.selectedColor = preset.color;
        const input = contentEl.querySelector<HTMLInputElement>('input[type="color"]');
        if (input) {
          input.value = preset.color;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }

    new Setting(contentEl)
      .setName("Color")
      .setDesc("Choose a custom color for this tab.")
      .addColorPicker((picker) => {
        picker.setValue(this.selectedColor);
        picker.onChange((value) => {
          this.selectedColor = value;
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Apply").setCta().onClick(() => {
          this.result = this.selectedColor;
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.result = null;
          this.close();
        });
      });

    contentEl.querySelector<HTMLInputElement>('input[type="color"]')?.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    this.onSubmit(this.result);
  }
}

export default class TabColorsPlugin extends Plugin {
  settings: TabColorsSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new TabColorsSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
        if (!(file instanceof TFile)) {
          return;
        }

        this.addTabColorMenuItems(menu, file, source, leaf ?? null);
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.applyAllTabColors();
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.applyAllTabColors();
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.applyAllTabColors();
    });
  }

  onunload(): void {
    this.clearAllTabStyles();
  }

  private addTabColorMenuItems(menu: Menu, file: TFile, source: string, leaf: unknown | null): void {
    const isLikelyTabContext = source.toLowerCase().includes("tab") || source.toLowerCase().includes("leaf");

    menu.addItem((item) => {
      item
        .setTitle("Set Tab Color")
        .setIcon("palette")
        .setSection("action")
        .setChecked(Boolean(this.settings.fileColors[file.path]))
        .onClick(() => {
          const current = this.settings.fileColors[file.path] ?? null;
          new ColorPickerModal(this, current, this.settings.presetColors, async (selected) => {
            if (!selected) {
              return;
            }

            this.settings.fileColors[file.path] = selected;
            await this.saveSettings();
            this.applyAllTabColors();
          }).open();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Clear Tab Color")
        .setIcon("paintbrush")
        .setSection("action")
        .setDisabled(!this.settings.fileColors[file.path])
        .onClick(async () => {
          delete this.settings.fileColors[file.path];
          await this.saveSettings();
          this.applyAllTabColors();
        });
    });
  }

  private getFileFromLeaf(leaf: unknown): TFile | null {
    if (!leaf || typeof leaf !== "object") {
      return null;
    }

    const file = (leaf as { view?: FileView }).view?.file;
    return file instanceof TFile ? file : null;
  }

  private getTabHeaderEl(leaf: unknown): HTMLElement | null {
    if (!leaf || typeof leaf !== "object") {
      return null;
    }

    const tabHeaderEl = (leaf as { tabHeaderEl?: HTMLElement }).tabHeaderEl;
    if (tabHeaderEl instanceof HTMLElement) {
      return tabHeaderEl;
    }

    return null;
  }

  private applyAllTabColors(): void {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      this.applyTabColorForLeaf(leaf);
    }
  }

  private applyTabColorForLeaf(leaf: unknown): void {
    const tabHeaderEl = this.getTabHeaderEl(leaf);
    if (!tabHeaderEl) {
      return;
    }

    const file = this.getFileFromLeaf(leaf);
    const color = file ? this.settings.fileColors[file.path] : null;

    if (color) {
      const textColor = this.getContrastingTextColor(color);
      tabHeaderEl.classList.add("tab-colors-custom");
      tabHeaderEl.style.setProperty("--tab-colors-bg", color);
      tabHeaderEl.style.setProperty("--tab-colors-text", textColor);
    } else {
      tabHeaderEl.classList.remove("tab-colors-custom");
      tabHeaderEl.style.removeProperty("--tab-colors-bg");
      tabHeaderEl.style.removeProperty("--tab-colors-text");
    }
  }

  private clearAllTabStyles(): void {
    const coloredTabs = document.querySelectorAll<HTMLElement>(".workspace-tab-header.tab-colors-custom");
    coloredTabs.forEach((tab) => {
      tab.classList.remove("tab-colors-custom");
      tab.style.removeProperty("--tab-colors-bg");
      tab.style.removeProperty("--tab-colors-text");
    });
  }

  private getContrastingTextColor(color: string): string {
    const rgb = this.parseHexColor(color);
    if (!rgb) {
      return "#111111";
    }

    const [r, g, b] = rgb.map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.45 ? "#111111" : "#ffffff";
  }

  private parseHexColor(color: string): [number, number, number] | null {
    const hex = color.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16)
      ];
    }

    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16)
      ];
    }

    return null;
  }

  private async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = this.normalizeSettings(loaded);
  }

  private async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private normalizeSettings(loaded: unknown): TabColorsSettings {
    const raw = (loaded ?? {}) as Partial<TabColorsSettings> & { presetColors?: unknown[] };
    const presetSource = Array.isArray(raw.presetColors) ? raw.presetColors : DEFAULT_PRESET_COLORS;
    const presetColors = presetSource
      .map((value, index) => this.normalizePreset(value, index))
      .filter((value): value is PresetColor => value !== null);

    return {
      fileColors: raw.fileColors ?? {},
      presetColors: presetColors.length > 0 ? presetColors : DEFAULT_PRESET_COLORS.map((preset) => ({ ...preset }))
    };
  }

  private normalizePreset(value: unknown, index: number): PresetColor | null {
    if (typeof value === "string" && value.length > 0) {
      return {
        name: `Preset ${index + 1}`,
        color: value
      };
    }

    if (value && typeof value === "object") {
      const candidate = value as Partial<PresetColor>;
      if (typeof candidate.color !== "string" || candidate.color.length === 0) {
        return null;
      }

      return {
        name: typeof candidate.name === "string" && candidate.name.length > 0 ? candidate.name : `Preset ${index + 1}`,
        color: candidate.color
      };
    }

    return null;
  }
}

class TabColorsSettingTab extends PluginSettingTab {
  private readonly plugin: TabColorsPlugin;

  constructor(app: App, plugin: TabColorsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Tab Colors" });

    new Setting(containerEl)
      .setName("Preset swatches")
      .setDesc("These colors appear as quick-pick swatches in the tab color modal.");

    this.plugin.settings.presetColors.forEach((preset, index) => {
      new Setting(containerEl)
        .setName(`Preset ${index + 1}`)
        .addText((text) => {
          text.setPlaceholder("Name").setValue(preset.name).onChange(async (value) => {
            this.plugin.settings.presetColors[index].name = value.trim() || `Preset ${index + 1}`;
            await this.plugin.saveData(this.plugin.settings);
          });
        })
        .addColorPicker((picker) => {
          picker.setValue(preset.color);
          picker.onChange(async (value) => {
            this.plugin.settings.presetColors[index].color = value;
            await this.plugin.saveData(this.plugin.settings);
          });
        })
        .addExtraButton((button) => {
          button.setIcon("trash").setTooltip("Remove preset").onClick(async () => {
            this.plugin.settings.presetColors.splice(index, 1);
            if (this.plugin.settings.presetColors.length === 0) {
              this.plugin.settings.presetColors = DEFAULT_PRESET_COLORS.map((entry) => ({ ...entry }));
            }
            await this.plugin.saveData(this.plugin.settings);
            this.display();
          });
        });
    });

    new Setting(containerEl)
      .addButton((button) => {
        button.setButtonText("Add preset").onClick(async () => {
          this.plugin.settings.presetColors.push({
            name: `Preset ${this.plugin.settings.presetColors.length + 1}`,
            color: "#3aa6ff"
          });
          await this.plugin.saveData(this.plugin.settings);
          this.display();
        });
      })
      .addButton((button) => {
        button.setButtonText("Reset defaults").onClick(async () => {
          this.plugin.settings.presetColors = DEFAULT_PRESET_COLORS.map((preset) => ({ ...preset }));
          await this.plugin.saveData(this.plugin.settings);
          this.display();
        });
      });
  }
}

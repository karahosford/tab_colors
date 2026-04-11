import { App, FileView, Menu, Modal, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

interface PresetColor {
  name: string;
  color: string;
}

interface TabColorsSettings {
  fileColors: Record<string, string>;
  presetColors: PresetColor[];
  tagColorRules: TagColorRule[];
  blendLengthPx: number;
  blendIntensity: number;
  noteBackgroundEffect: "none" | "gradient" | "dots";
  dotSizePx: number;
  dotSpacingPx: number;
  dotIntensity: number;
}

interface TagColorRule {
  tag: string;
  color: string;
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
  presetColors: [...DEFAULT_PRESET_COLORS],
  tagColorRules: [],
  blendLengthPx: 260,
  blendIntensity: 100,
  noteBackgroundEffect: "gradient",
  dotSizePx: 2,
  dotSpacingPx: 16,
  dotIntensity: 55
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
    this.applyGlobalBlendSettings();
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

    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.applyAllTabColors();
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.applyAllTabColors();
    });
  }

  onunload(): void {
    this.clearAllTabStyles();
    document.body.style.removeProperty("--tab-colors-blend-length");
    document.body.style.removeProperty("--tab-colors-dot-size");
    document.body.style.removeProperty("--tab-colors-dot-spacing");
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

  private getLeafContainerEl(leaf: unknown): HTMLElement | null {
    if (!leaf || typeof leaf !== "object") {
      return null;
    }

    const containerEl = (leaf as { containerEl?: HTMLElement }).containerEl;
    return containerEl instanceof HTMLElement ? containerEl : null;
  }

  private isVerticalTabLayout(tabHeaderEl: HTMLElement | null): boolean {
    if (!tabHeaderEl) {
      return false;
    }

    const tabsContainer = tabHeaderEl.closest(".workspace-tabs");
    return Boolean(tabsContainer?.classList.contains("mod-vertical") || tabsContainer?.classList.contains("mod-stacked"));
  }

  applyAllTabColors(): void {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      this.applyTabColorForLeaf(leaf);
    }
  }

  private applyTabColorForLeaf(leaf: unknown): void {
    const tabHeaderEl = this.getTabHeaderEl(leaf);
    const leafContainerEl = this.getLeafContainerEl(leaf);
    const isVerticalLayout = this.isVerticalTabLayout(tabHeaderEl);

    const file = this.getFileFromLeaf(leaf);
    const color = file ? this.resolveColorForFile(file) : null;

    if (color) {
      const textColor = this.getContrastingTextColor(color);
      if (tabHeaderEl) {
        tabHeaderEl.classList.add("tab-colors-custom");
        tabHeaderEl.style.setProperty("--tab-colors-bg", color);
        tabHeaderEl.style.setProperty("--tab-colors-text", textColor);
      }

      if (leafContainerEl) {
        leafContainerEl.style.setProperty("--tab-colors-note-blend", color);
        this.applyLeafBlendStrengthVariables(leafContainerEl, color);

        const effect = this.settings.noteBackgroundEffect;
        const hasNoteEffect = effect !== "none";
        leafContainerEl.classList.toggle("tab-colors-note-blend", hasNoteEffect);
        leafContainerEl.classList.toggle("tab-colors-note-effect-gradient", hasNoteEffect && effect === "gradient");
        leafContainerEl.classList.toggle("tab-colors-note-effect-dots", hasNoteEffect && effect === "dots");
        leafContainerEl.classList.toggle("tab-colors-note-blend-vertical", hasNoteEffect && effect === "gradient" && isVerticalLayout);
        leafContainerEl.classList.toggle("tab-colors-note-blend-horizontal", hasNoteEffect && effect === "gradient" && !isVerticalLayout);
      }
    } else {
      if (tabHeaderEl) {
        tabHeaderEl.classList.remove("tab-colors-custom");
        tabHeaderEl.style.removeProperty("--tab-colors-bg");
        tabHeaderEl.style.removeProperty("--tab-colors-text");
      }

      if (leafContainerEl) {
        leafContainerEl.classList.remove("tab-colors-note-blend");
        leafContainerEl.classList.remove("tab-colors-note-effect-gradient");
        leafContainerEl.classList.remove("tab-colors-note-effect-dots");
        leafContainerEl.classList.remove("tab-colors-note-blend-vertical");
        leafContainerEl.classList.remove("tab-colors-note-blend-horizontal");
        leafContainerEl.style.removeProperty("--tab-colors-note-blend");
        leafContainerEl.style.removeProperty("--tab-colors-note-blend-78");
        leafContainerEl.style.removeProperty("--tab-colors-note-blend-45");
        leafContainerEl.style.removeProperty("--tab-colors-note-blend-18");
        leafContainerEl.style.removeProperty("--tab-colors-dot-color");
      }
    }
  }

  private clearAllTabStyles(): void {
    const coloredTabs = document.querySelectorAll<HTMLElement>(".workspace-tab-header.tab-colors-custom");
    coloredTabs.forEach((tab) => {
      tab.classList.remove("tab-colors-custom");
      tab.style.removeProperty("--tab-colors-bg");
      tab.style.removeProperty("--tab-colors-text");
    });

    const blendedLeaves = document.querySelectorAll<HTMLElement>(".workspace-leaf.tab-colors-note-blend");
    blendedLeaves.forEach((leaf) => {
      leaf.classList.remove("tab-colors-note-blend");
      leaf.classList.remove("tab-colors-note-effect-gradient");
      leaf.classList.remove("tab-colors-note-effect-dots");
      leaf.classList.remove("tab-colors-note-blend-vertical");
      leaf.classList.remove("tab-colors-note-blend-horizontal");
      leaf.style.removeProperty("--tab-colors-note-blend");
      leaf.style.removeProperty("--tab-colors-note-blend-78");
      leaf.style.removeProperty("--tab-colors-note-blend-45");
      leaf.style.removeProperty("--tab-colors-note-blend-18");
      leaf.style.removeProperty("--tab-colors-dot-color");
    });
  }

  private resolveColorForFile(file: TFile): string | null {
    const manualColor = this.settings.fileColors[file.path];
    if (manualColor) {
      return manualColor;
    }

    return this.getTagRuleColor(file);
  }

  private getTagRuleColor(file: TFile): string | null {
    if (this.settings.tagColorRules.length === 0) {
      return null;
    }

    const fileTags = this.getFileTags(file);
    if (fileTags.size === 0) {
      return null;
    }

    for (const rule of this.settings.tagColorRules) {
      const normalizedTag = this.normalizeTag(rule.tag);
      if (normalizedTag && fileTags.has(normalizedTag)) {
        return rule.color;
      }
    }

    return null;
  }

  private getFileTags(file: TFile): Set<string> {
    const tags = new Set<string>();
    const cache = this.app.metadataCache.getFileCache(file);

    cache?.tags?.forEach((entry) => {
      const normalized = this.normalizeTag(entry.tag);
      if (normalized) {
        tags.add(normalized);
      }
    });

    const frontmatterTags = cache?.frontmatter?.tags;
    if (typeof frontmatterTags === "string") {
      const normalized = this.normalizeTag(frontmatterTags);
      if (normalized) {
        tags.add(normalized);
      }
    }

    if (Array.isArray(frontmatterTags)) {
      frontmatterTags.forEach((tagValue) => {
        if (typeof tagValue !== "string") {
          return;
        }
        const normalized = this.normalizeTag(tagValue);
        if (normalized) {
          tags.add(normalized);
        }
      });
    }

    return tags;
  }

  normalizeTag(tag: string): string {
    const value = tag.trim().toLowerCase();
    if (!value) {
      return "";
    }

    return value.startsWith("#") ? value : `#${value}`;
  }

  applyGlobalBlendSettings(): void {
    const blendLength = this.clamp(Math.round(this.settings.blendLengthPx), 80, 600);
    const dotSize = this.clamp(this.settings.dotSizePx, 1, 8);
    const dotSpacing = this.clamp(this.settings.dotSpacingPx, 6, 40);
    document.body.style.setProperty("--tab-colors-blend-length", `${blendLength}px`);
    document.body.style.setProperty("--tab-colors-dot-size", `${dotSize}px`);
    document.body.style.setProperty("--tab-colors-dot-spacing", `${dotSpacing}px`);
  }

  private applyLeafBlendStrengthVariables(leafContainerEl: HTMLElement, color: string): void {
    const rgb = this.parseHexColor(color);
    if (!rgb) {
      return;
    }

    const strength = this.clamp(this.settings.blendIntensity, 0, 100) / 100;
    const dotStrength = this.clamp(this.settings.dotIntensity, 0, 100) / 100;
    const [r, g, b] = rgb;
    leafContainerEl.style.setProperty("--tab-colors-note-blend-78", `rgba(${r}, ${g}, ${b}, ${(0.78 * strength).toFixed(3)})`);
    leafContainerEl.style.setProperty("--tab-colors-note-blend-45", `rgba(${r}, ${g}, ${b}, ${(0.45 * strength).toFixed(3)})`);
    leafContainerEl.style.setProperty("--tab-colors-note-blend-18", `rgba(${r}, ${g}, ${b}, ${(0.18 * strength).toFixed(3)})`);
    leafContainerEl.style.setProperty("--tab-colors-dot-color", `rgba(${r}, ${g}, ${b}, ${(0.30 * dotStrength).toFixed(3)})`);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
    const raw = (loaded ?? {}) as Partial<TabColorsSettings> & { presetColors?: unknown[]; tagColorRules?: unknown[] };
    const presetSource = Array.isArray(raw.presetColors) ? raw.presetColors : DEFAULT_PRESET_COLORS;
    const presetColors = presetSource
      .map((value, index) => this.normalizePreset(value, index))
      .filter((value): value is PresetColor => value !== null);
    const tagRuleSource = Array.isArray(raw.tagColorRules) ? raw.tagColorRules : [];
    const tagColorRules = tagRuleSource
      .map((value) => this.normalizeTagRule(value))
      .filter((value): value is TagColorRule => value !== null);

    return {
      fileColors: raw.fileColors ?? {},
      presetColors: presetColors.length > 0 ? presetColors : DEFAULT_PRESET_COLORS.map((preset) => ({ ...preset })),
      tagColorRules,
      blendLengthPx: this.clamp(Number(raw.blendLengthPx ?? DEFAULT_SETTINGS.blendLengthPx), 80, 600),
      blendIntensity: this.clamp(Number(raw.blendIntensity ?? DEFAULT_SETTINGS.blendIntensity), 0, 100),
      noteBackgroundEffect: this.normalizeNoteBackgroundEffect((raw as { noteBackgroundEffect?: unknown }).noteBackgroundEffect),
      dotSizePx: this.clamp(Number((raw as { dotSizePx?: unknown }).dotSizePx ?? DEFAULT_SETTINGS.dotSizePx), 1, 8),
      dotSpacingPx: this.clamp(Number((raw as { dotSpacingPx?: unknown }).dotSpacingPx ?? DEFAULT_SETTINGS.dotSpacingPx), 6, 40),
      dotIntensity: this.clamp(Number((raw as { dotIntensity?: unknown }).dotIntensity ?? DEFAULT_SETTINGS.dotIntensity), 0, 100)
    };
  }

  private normalizeNoteBackgroundEffect(value: unknown): "none" | "gradient" | "dots" {
    if (value === "none" || value === "gradient" || value === "dots") {
      return value;
    }

    return DEFAULT_SETTINGS.noteBackgroundEffect;
  }

  private normalizeTagRule(value: unknown): TagColorRule | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const rule = value as Partial<TagColorRule>;
    if (typeof rule.tag !== "string" || typeof rule.color !== "string") {
      return null;
    }

    const tag = this.normalizeTag(rule.tag);
    if (!tag || rule.color.trim().length === 0) {
      return null;
    }

    return {
      tag,
      color: rule.color
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

    containerEl.createEl("h3", { text: "Tag Auto Colors" });

    new Setting(containerEl)
      .setName("Tag color rules")
      .setDesc("Auto-apply a tab color when a note includes a matching tag. Manual tab colors take priority.");

    this.plugin.settings.tagColorRules.forEach((rule, index) => {
      new Setting(containerEl)
        .setName(`Rule ${index + 1}`)
        .addText((text) => {
          text
            .setPlaceholder("tag or #tag")
            .setValue(rule.tag)
            .onChange(async (value) => {
              this.plugin.settings.tagColorRules[index].tag = this.plugin.normalizeTag(value) || "#tag";
              await this.plugin.saveData(this.plugin.settings);
              this.plugin.applyAllTabColors();
            });
        })
        .addColorPicker((picker) => {
          picker.setValue(rule.color);
          picker.onChange(async (value) => {
            this.plugin.settings.tagColorRules[index].color = value;
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.applyAllTabColors();
          });
        })
        .addExtraButton((button) => {
          button.setIcon("trash").setTooltip("Remove rule").onClick(async () => {
            this.plugin.settings.tagColorRules.splice(index, 1);
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.applyAllTabColors();
            this.display();
          });
        });
    });

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Add tag rule").onClick(async () => {
        this.plugin.settings.tagColorRules.push({ tag: "#topic", color: "#3aa6ff" });
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
        this.display();
      });
    });

    containerEl.createEl("h3", { text: "Note Blend" });

    new Setting(containerEl)
      .setName("Note background effect")
      .setDesc("Choose how the note background reacts to the tab color.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("none", "None")
          .addOption("gradient", "Gradient")
          .addOption("dots", "Dotted pattern")
          .setValue(this.plugin.settings.noteBackgroundEffect)
          .onChange(async (value) => {
            this.plugin.settings.noteBackgroundEffect = value as "none" | "gradient" | "dots";
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.applyAllTabColors();
          });
      });

    new Setting(containerEl)
      .setName("Blend intensity")
      .setDesc("How strong the note background tint appears (0-100%).")
      .addSlider((slider) => {
        slider.setLimits(0, 100, 1).setValue(this.plugin.settings.blendIntensity).setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.blendIntensity = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
        });
      });

    new Setting(containerEl)
      .setName("Blend length")
      .setDesc("How far the gradient extends into the note pane in pixels (80-600). Used for gradient mode.")
      .addSlider((slider) => {
        slider.setLimits(80, 600, 10).setValue(this.plugin.settings.blendLengthPx).setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.blendLengthPx = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyGlobalBlendSettings();
          this.plugin.applyAllTabColors();
        });
      });

    new Setting(containerEl)
      .setName("Dot size")
      .setDesc("Dot size in pixels for dotted mode.")
      .addSlider((slider) => {
        slider.setLimits(1, 8, 1).setValue(this.plugin.settings.dotSizePx).setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.dotSizePx = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyGlobalBlendSettings();
          this.plugin.applyAllTabColors();
        });
      });

    new Setting(containerEl)
      .setName("Dot spacing")
      .setDesc("Distance between dots in pixels for dotted mode.")
      .addSlider((slider) => {
        slider.setLimits(6, 40, 1).setValue(this.plugin.settings.dotSpacingPx).setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.dotSpacingPx = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyGlobalBlendSettings();
          this.plugin.applyAllTabColors();
        });
      });

    new Setting(containerEl)
      .setName("Dot intensity")
      .setDesc("How visible the dots are in dotted mode (0-100%).")
      .addSlider((slider) => {
        slider.setLimits(0, 100, 1).setValue(this.plugin.settings.dotIntensity).setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.dotIntensity = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
        });
      });
  }
}

import { App, FileView, Menu, MenuItem, Modal, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

interface PresetColor {
  name: string;
  color: string;
}

interface TabColorsSettings {
  fileColors: Record<string, string>;
  presetColors: PresetColor[];
  tagColorRules: TagColorRule[];
  folderColorRules: FolderColorRule[];
  frontmatterColorKey: string;
  accessibilityMode: boolean;
  minContrastRatio: number;
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

interface FolderColorRule {
  folder: string;
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
  folderColorRules: [],
  frontmatterColorKey: "tabColor",
  accessibilityMode: false,
  minContrastRatio: 7,
  blendLengthPx: 260,
  blendIntensity: 100,
  noteBackgroundEffect: "dots",
  dotSizePx: 2,
  dotSpacingPx: 16,
  dotIntensity: 55
};

class ColorPickerModal extends Modal {
  private result: string | null = null;
  private selectedColor: string;
  private readonly plugin: TabColorsPlugin;
  private readonly onSubmit: (color: string | null) => void;
  private readonly presetColors: PresetColor[];

  constructor(plugin: TabColorsPlugin, initialColor: string | null, presetColors: PresetColor[], onSubmit: (color: string | null) => void) {
    super(plugin.app);
    this.plugin = plugin;
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
          updateContrastWarning();
        });
      });

    const warningEl = contentEl.createDiv({ cls: "tab-colors-contrast-warning" });
    const updateContrastWarning = (): void => {
      const warning = this.plugin.getContrastWarning(this.selectedColor);
      warningEl.textContent = warning ?? "";
      warningEl.classList.toggle("is-visible", Boolean(warning));
    };
    updateContrastWarning();

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
  private applyAllTimeoutId: number | null = null;
  private readonly leafApplyState = new WeakMap<object, string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyGlobalBlendSettings();
    this.addSettingTab(new TabColorsSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof TFile)) {
          return;
        }

        const existing = this.settings.fileColors[oldPath];
        if (!existing) {
          return;
        }

        delete this.settings.fileColors[oldPath];
        this.settings.fileColors[file.path] = existing;
        await this.saveSettings();
        this.scheduleApplyAllTabColors(0);
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (!(file instanceof TFile)) {
          return;
        }

        if (!this.settings.fileColors[file.path]) {
          return;
        }

        delete this.settings.fileColors[file.path];
        await this.saveSettings();
      })
    );

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
        this.scheduleApplyAllTabColors();
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.scheduleApplyAllTabColors();
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.scheduleApplyAllTabColors();
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.scheduleApplyAllTabColors(0);
    });

    this.addCommand({
      id: "set-tab-color",
      name: "Set color for current tab",
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          if (!checking) {
            const current = this.settings.fileColors[activeFile.path] ?? null;
            new ColorPickerModal(this, current, this.settings.presetColors, async (selected) => {
              if (!selected) {
                return;
              }

              this.settings.fileColors[activeFile.path] = selected;
              await this.saveSettings();
              this.scheduleApplyAllTabColors(0);
            }).open();
          }
          return true;
        }
        return false;
      }
    });

    this.addCommand({
      id: "clear-tab-color",
      name: "Clear color for current tab",
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && this.settings.fileColors[activeFile.path]) {
          if (!checking) {
            delete this.settings.fileColors[activeFile.path];
            this.saveSettings().then(() => this.scheduleApplyAllTabColors(0));
          }
          return true;
        }
        return false;
      }
    });
  }

  onunload(): void {
    if (this.applyAllTimeoutId !== null) {
      window.clearTimeout(this.applyAllTimeoutId);
      this.applyAllTimeoutId = null;
    }
    this.clearAllTabStyles();
    document.body.style.removeProperty("--tab-colors-blend-length");
    document.body.style.removeProperty("--tab-colors-dot-size");
    document.body.style.removeProperty("--tab-colors-dot-spacing");
  }

  private addTabColorMenuItems(menu: Menu, file: TFile, source: string, leaf: unknown | null): void {
    const sourceLower = source.toLowerCase();
    const isLikelyTabContext = sourceLower.includes("tab") || sourceLower.includes("leaf");
    const hasTabHeader = this.getTabHeaderEl(leaf) !== null;
    if (!isLikelyTabContext && !hasTabHeader) {
      return;
    }

    menu.addItem((item) => {
      const subMenu = (item
        .setTitle("Set Tab Color")
        .setIcon("palette")
        .setSection("action") as unknown as { setSubmenu: () => Menu }).setSubmenu();

      this.settings.presetColors.forEach((preset) => {
        subMenu.addItem((subItem: MenuItem) => {
          subItem
            .setTitle(preset.name)
            .onClick(async () => {
              this.settings.fileColors[file.path] = preset.color;
              await this.saveSettings();
              this.scheduleApplyAllTabColors(0);
            });
        });
      });

      subMenu.addSeparator();

      subMenu.addItem((subItem: MenuItem) => {
        subItem
          .setTitle("Custom Color...")
          .setIcon("palette")
          .onClick(() => {
            const current = this.settings.fileColors[file.path] ?? null;
            new ColorPickerModal(this, current, this.settings.presetColors, async (selected) => {
              if (!selected) {
                return;
              }

              this.settings.fileColors[file.path] = selected;
              await this.saveSettings();
              this.scheduleApplyAllTabColors(0);
            }).open();
          });
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
          this.scheduleApplyAllTabColors(0);
        });
    });
  }

  private scheduleApplyAllTabColors(delayMs = 60): void {
    if (this.applyAllTimeoutId !== null) {
      window.clearTimeout(this.applyAllTimeoutId);
    }

    this.applyAllTimeoutId = window.setTimeout(() => {
      this.applyAllTimeoutId = null;
      this.applyAllTabColors();
    }, delayMs);
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
    const workspaceWithIterator = this.app.workspace as {
      iterateAllLeaves?: (callback: (leaf: unknown) => void) => void;
    };

    if (typeof workspaceWithIterator.iterateAllLeaves === "function") {
      workspaceWithIterator.iterateAllLeaves((leaf) => {
        this.applyTabColorForLeaf(leaf);
      });
      return;
    }

    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      this.applyTabColorForLeaf(leaf);
    }
  }

  private applyTabColorForLeaf(leaf: unknown): void {
    const tabHeaderEl = this.getTabHeaderEl(leaf);
    const leafContainerEl = this.getLeafContainerEl(leaf);
    const isVerticalLayout = this.isVerticalTabLayout(tabHeaderEl);

    const file = this.getFileFromLeaf(leaf);
    const color = file ? this.resolveColorForFile(file) : null;
    const effect = this.settings.noteBackgroundEffect;
    const state = color
      ? [
        color,
        effect,
        isVerticalLayout ? "vertical" : "horizontal",
        this.settings.accessibilityMode ? "a11y-on" : "a11y-off",
        String(this.settings.minContrastRatio),
        String(this.settings.blendIntensity),
        String(this.settings.dotIntensity)
      ].join("|")
      : "none";

    if (typeof leaf === "object" && leaf !== null) {
      const previousState = this.leafApplyState.get(leaf);
      if (previousState === state) {
        return;
      }
      this.leafApplyState.set(leaf, state);
    }

    if (color) {
      const textColor = this.getContrastingTextColor(color);
      const contrastWarning = this.getContrastWarning(color);
      if (tabHeaderEl) {
        tabHeaderEl.classList.add("tab-colors-custom");
        tabHeaderEl.classList.toggle("tab-colors-low-contrast", Boolean(contrastWarning));
        tabHeaderEl.style.setProperty("--tab-colors-bg", color);
        tabHeaderEl.style.setProperty("--tab-colors-text", textColor);
        if (contrastWarning) {
          tabHeaderEl.setAttribute("title", contrastWarning);
        } else {
          tabHeaderEl.removeAttribute("title");
        }
      }

      if (leafContainerEl) {
        leafContainerEl.style.setProperty("--tab-colors-note-blend", color);
        this.applyLeafBlendStrengthVariables(leafContainerEl, color);

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
        tabHeaderEl.classList.remove("tab-colors-low-contrast");
        tabHeaderEl.style.removeProperty("--tab-colors-bg");
        tabHeaderEl.style.removeProperty("--tab-colors-text");
        tabHeaderEl.removeAttribute("title");
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
      tab.classList.remove("tab-colors-low-contrast");
      tab.style.removeProperty("--tab-colors-bg");
      tab.style.removeProperty("--tab-colors-text");
      tab.removeAttribute("title");
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

    const frontmatterColor = this.getFrontmatterColor(file);
    if (frontmatterColor) {
      return frontmatterColor;
    }

    const tagColor = this.getTagRuleColor(file);
    if (tagColor) {
      return tagColor;
    }

    return this.getFolderRuleColor(file);
  }

  private getFolderRuleColor(file: TFile): string | null {
    if (this.settings.folderColorRules.length === 0) {
      return null;
    }

    const parentPath = file.parent?.path;
    if (parentPath === undefined) return null;

    for (const rule of this.settings.folderColorRules) {
      let ruleFolder = rule.folder.trim();
      if (ruleFolder.startsWith('/')) ruleFolder = ruleFolder.slice(1);
      if (ruleFolder.endsWith('/')) ruleFolder = ruleFolder.slice(0, -1);
      
      if (ruleFolder === "" && (parentPath === "/" || parentPath === "")) {
        return rule.color;
      }
      if (parentPath === ruleFolder || parentPath.startsWith(ruleFolder + "/")) {
        return rule.color;
      }
    }

    return null;
  }

  private getFrontmatterColor(file: TFile): string | null {
    const configuredKey = this.settings.frontmatterColorKey.trim();
    if (!configuredKey) {
      return null;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter || typeof frontmatter !== "object") {
      return null;
    }

    const frontmatterMap = frontmatter as Record<string, unknown>;
    let rawValue = frontmatterMap[configuredKey];
    if (rawValue === undefined) {
      const configuredKeyLower = configuredKey.toLowerCase();
      const matchedKey = Object.keys(frontmatterMap).find((key) => key.toLowerCase() === configuredKeyLower);
      if (matchedKey) {
        rawValue = frontmatterMap[matchedKey];
      }
    }

    if (typeof rawValue !== "string") {
      return null;
    }

    return this.normalizeHexColorValue(rawValue);
  }

  private normalizeHexColorValue(value: string): string | null {
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed) || /^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed;
    }

    if (/^[0-9a-fA-F]{3}$/.test(trimmed) || /^[0-9a-fA-F]{6}$/.test(trimmed)) {
      return `#${trimmed}`;
    }

    return null;
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
    const report = this.getContrastReport(color);
    if (report) {
      return report.textColor;
    }

    return "#111111";
  }

  getContrastWarning(color: string): string | null {
    if (!this.settings.accessibilityMode) {
      return null;
    }

    const report = this.getContrastReport(color);
    if (!report) {
      return null;
    }

    if (report.ratio >= this.settings.minContrastRatio) {
      return null;
    }

    return `Low contrast: best text ratio ${report.ratio.toFixed(2)}:1 is below minimum ${this.settings.minContrastRatio.toFixed(1)}:1`;
  }

  private getContrastReport(color: string): { textColor: string; ratio: number } | null {
    const rgb = this.parseHexColor(color);
    if (!rgb) {
      return null;
    }

    const bgLuminance = this.getRelativeLuminance(rgb[0], rgb[1], rgb[2]);
    const blackContrast = this.getContrastRatio(bgLuminance, 0);
    const whiteContrast = this.getContrastRatio(bgLuminance, 1);
    if (blackContrast >= whiteContrast) {
      return { textColor: "#111111", ratio: blackContrast };
    }

    return { textColor: "#ffffff", ratio: whiteContrast };
  }

  private getRelativeLuminance(r: number, g: number, b: number): number {
    const channels = [r, g, b].map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  private getContrastRatio(firstLuminance: number, secondLuminance: number): number {
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
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
    const raw = (loaded ?? {}) as Partial<TabColorsSettings> & { presetColors?: unknown[]; tagColorRules?: unknown[]; folderColorRules?: unknown[] };
    const presetSource = Array.isArray(raw.presetColors) ? raw.presetColors : DEFAULT_PRESET_COLORS;
    const presetColors = presetSource
      .map((value, index) => this.normalizePreset(value, index))
      .filter((value): value is PresetColor => value !== null);
    const tagRuleSource = Array.isArray(raw.tagColorRules) ? raw.tagColorRules : [];
    const tagColorRules = tagRuleSource
      .map((value) => this.normalizeTagRule(value))
      .filter((value): value is TagColorRule => value !== null);
    const folderRuleSource = Array.isArray(raw.folderColorRules) ? raw.folderColorRules : [];
    const folderColorRules = folderRuleSource
      .map((value) => this.normalizeFolderRule(value))
      .filter((value): value is FolderColorRule => value !== null);
    const frontmatterColorKey = typeof raw.frontmatterColorKey === "string" && raw.frontmatterColorKey.trim().length > 0
      ? raw.frontmatterColorKey.trim()
      : DEFAULT_SETTINGS.frontmatterColorKey;

    return {
      fileColors: raw.fileColors ?? {},
      presetColors: presetColors.length > 0 ? presetColors : DEFAULT_PRESET_COLORS.map((preset) => ({ ...preset })),
      tagColorRules,
      folderColorRules,
      frontmatterColorKey,
      accessibilityMode: Boolean((raw as { accessibilityMode?: unknown }).accessibilityMode),
      minContrastRatio: this.clamp(Number((raw as { minContrastRatio?: unknown }).minContrastRatio ?? DEFAULT_SETTINGS.minContrastRatio), 4.5, 12),
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

  private normalizeFolderRule(value: unknown): FolderColorRule | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const rule = value as Partial<FolderColorRule>;
    if (typeof rule.folder !== "string" || typeof rule.color !== "string") {
      return null;
    }

    if (rule.color.trim().length === 0) {
      return null;
    }

    return {
      folder: rule.folder,
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

    containerEl.createEl("h3", { text: "Folder Auto Colors" });

    new Setting(containerEl)
      .setName("Folder color rules")
      .setDesc("Auto-apply a tab color when a note is inside a matching folder. Tag and manual colors take priority.");

    this.plugin.settings.folderColorRules.forEach((rule, index) => {
      new Setting(containerEl)
        .setName(`Rule ${index + 1}`)
        .addText((text) => {
          text
            .setPlaceholder("Folder path (e.g. Journal)")
            .setValue(rule.folder)
            .onChange(async (value) => {
              this.plugin.settings.folderColorRules[index].folder = value;
              await this.plugin.saveData(this.plugin.settings);
              this.plugin.applyAllTabColors();
            });
        })
        .addColorPicker((picker) => {
          picker.setValue(rule.color);
          picker.onChange(async (value) => {
            this.plugin.settings.folderColorRules[index].color = value;
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.applyAllTabColors();
          });
        })
        .addExtraButton((button) => {
          button.setIcon("trash").setTooltip("Remove rule").onClick(async () => {
            this.plugin.settings.folderColorRules.splice(index, 1);
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.applyAllTabColors();
            this.display();
          });
        });
    });

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Add folder rule").onClick(async () => {
        this.plugin.settings.folderColorRules.push({ folder: "Folder", color: "#3aa6ff" });
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
        this.display();
      });
    });

    containerEl.createEl("h3", { text: "Frontmatter Auto Colors" });

    new Setting(containerEl)
      .setName("Frontmatter color key")
      .setDesc("Use a frontmatter field for per-note tab color (hex only). Example: tabColor: '#3aa6ff'. Priority: manual > frontmatter > tag > folder.")
      .addText((text) => {
        text
          .setPlaceholder("tabColor")
          .setValue(this.plugin.settings.frontmatterColorKey)
          .onChange(async (value) => {
            this.plugin.settings.frontmatterColorKey = value.trim() || DEFAULT_SETTINGS.frontmatterColorKey;
            await this.plugin.saveData(this.plugin.settings);
            this.plugin.applyAllTabColors();
          });
      });

    containerEl.createEl("h3", { text: "Accessibility" });

    new Setting(containerEl)
      .setName("Accessibility mode")
      .setDesc("Auto-pick the best text color and warn when a tab color is below your minimum contrast ratio.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.accessibilityMode).onChange(async (value) => {
          this.plugin.settings.accessibilityMode = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Minimum contrast ratio")
      .setDesc("Used only when Accessibility mode is enabled. Higher values are stricter.")
      .addSlider((slider) => {
        slider.setLimits(4.5, 12, 0.5).setValue(this.plugin.settings.minContrastRatio).setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.minContrastRatio = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
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

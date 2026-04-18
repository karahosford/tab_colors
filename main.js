"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TabColorsPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_PRESET_COLORS = [
  { name: "Sky", color: "#3aa6ff" },
  { name: "Leaf", color: "#44cf6c" },
  { name: "Amber", color: "#ffb84d" },
  { name: "Coral", color: "#ff6b6b" },
  { name: "Violet", color: "#b07cff" },
  { name: "Teal", color: "#4ddac6" }
];
var DEFAULT_SETTINGS = {
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
var ColorPickerModal = class extends import_obsidian.Modal {
  result = null;
  selectedColor;
  plugin;
  onSubmit;
  presetColors;
  constructor(plugin, initialColor, presetColors, onSubmit) {
    super(plugin.app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
    this.presetColors = presetColors;
    this.selectedColor = initialColor ?? "#3aa6ff";
    this.setTitle("Set Tab Color");
  }
  onOpen() {
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
        const input = contentEl.querySelector('input[type="color"]');
        if (input) {
          input.value = preset.color;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }
    new import_obsidian.Setting(contentEl).setName("Color").setDesc("Choose a custom color for this tab.").addColorPicker((picker) => {
      picker.setValue(this.selectedColor);
      picker.onChange((value) => {
        this.selectedColor = value;
        updateContrastWarning();
      });
    });
    const warningEl = contentEl.createDiv({ cls: "tab-colors-contrast-warning" });
    const updateContrastWarning = () => {
      const warning = this.plugin.getContrastWarning(this.selectedColor);
      warningEl.textContent = warning ?? "";
      warningEl.classList.toggle("is-visible", Boolean(warning));
    };
    updateContrastWarning();
    new import_obsidian.Setting(contentEl).addButton((button) => {
      button.setButtonText("Apply").setCta().onClick(() => {
        this.result = this.selectedColor;
        this.close();
      });
    }).addButton((button) => {
      button.setButtonText("Cancel").onClick(() => {
        this.result = null;
        this.close();
      });
    });
    contentEl.querySelector('input[type="color"]')?.focus();
  }
  onClose() {
    this.contentEl.empty();
    this.onSubmit(this.result);
  }
};
var TabColorsPlugin = class extends import_obsidian.Plugin {
  settings = DEFAULT_SETTINGS;
  applyAllTimeoutId = null;
  leafApplyState = /* @__PURE__ */ new WeakMap();
  async onload() {
    await this.loadSettings();
    this.applyGlobalBlendSettings();
    this.addSettingTab(new TabColorsSettingTab(this.app, this));
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof import_obsidian.TFile)) {
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
        if (!(file instanceof import_obsidian.TFile)) {
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
        if (!(file instanceof import_obsidian.TFile)) {
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
      checkCallback: (checking) => {
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
      checkCallback: (checking) => {
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
  onunload() {
    if (this.applyAllTimeoutId !== null) {
      window.clearTimeout(this.applyAllTimeoutId);
      this.applyAllTimeoutId = null;
    }
    this.clearAllTabStyles();
    document.body.style.removeProperty("--tab-colors-blend-length");
    document.body.style.removeProperty("--tab-colors-dot-size");
    document.body.style.removeProperty("--tab-colors-dot-spacing");
  }
  addTabColorMenuItems(menu, file, source, leaf) {
    const sourceLower = source.toLowerCase();
    const isLikelyTabContext = sourceLower.includes("tab") || sourceLower.includes("leaf");
    const hasTabHeader = this.getTabHeaderEl(leaf) !== null;
    if (!isLikelyTabContext && !hasTabHeader) {
      return;
    }
    menu.addItem((item) => {
      const subMenu = item.setTitle("Set Tab Color").setIcon("palette").setSection("action").setSubmenu();
      this.settings.presetColors.forEach((preset) => {
        subMenu.addItem((subItem) => {
          subItem.setTitle(preset.name).onClick(async () => {
            this.settings.fileColors[file.path] = preset.color;
            await this.saveSettings();
            this.scheduleApplyAllTabColors(0);
          });
        });
      });
      subMenu.addSeparator();
      subMenu.addItem((subItem) => {
        subItem.setTitle("Custom Color...").setIcon("palette").onClick(() => {
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
      item.setTitle("Clear Tab Color").setIcon("paintbrush").setSection("action").setDisabled(!this.settings.fileColors[file.path]).onClick(async () => {
        delete this.settings.fileColors[file.path];
        await this.saveSettings();
        this.scheduleApplyAllTabColors(0);
      });
    });
  }
  scheduleApplyAllTabColors(delayMs = 60) {
    if (this.applyAllTimeoutId !== null) {
      window.clearTimeout(this.applyAllTimeoutId);
    }
    this.applyAllTimeoutId = window.setTimeout(() => {
      this.applyAllTimeoutId = null;
      this.applyAllTabColors();
    }, delayMs);
  }
  getFileFromLeaf(leaf) {
    if (!leaf || typeof leaf !== "object") {
      return null;
    }
    const file = leaf.view?.file;
    return file instanceof import_obsidian.TFile ? file : null;
  }
  getTabHeaderEl(leaf) {
    if (!leaf || typeof leaf !== "object") {
      return null;
    }
    const tabHeaderEl = leaf.tabHeaderEl;
    if (tabHeaderEl instanceof HTMLElement) {
      return tabHeaderEl;
    }
    return null;
  }
  getLeafContainerEl(leaf) {
    if (!leaf || typeof leaf !== "object") {
      return null;
    }
    const containerEl = leaf.containerEl;
    return containerEl instanceof HTMLElement ? containerEl : null;
  }
  isVerticalTabLayout(tabHeaderEl) {
    if (!tabHeaderEl) {
      return false;
    }
    const tabsContainer = tabHeaderEl.closest(".workspace-tabs");
    return Boolean(tabsContainer?.classList.contains("mod-vertical") || tabsContainer?.classList.contains("mod-stacked"));
  }
  applyAllTabColors() {
    const workspaceWithIterator = this.app.workspace;
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
  applyTabColorForLeaf(leaf) {
    const tabHeaderEl = this.getTabHeaderEl(leaf);
    const leafContainerEl = this.getLeafContainerEl(leaf);
    const isVerticalLayout = this.isVerticalTabLayout(tabHeaderEl);
    const file = this.getFileFromLeaf(leaf);
    const color = file ? this.resolveColorForFile(file) : null;
    const effect = this.settings.noteBackgroundEffect;
    const state = color ? [
      color,
      effect,
      isVerticalLayout ? "vertical" : "horizontal",
      this.settings.accessibilityMode ? "a11y-on" : "a11y-off",
      String(this.settings.minContrastRatio),
      String(this.settings.blendIntensity),
      String(this.settings.dotIntensity)
    ].join("|") : "none";
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
  clearAllTabStyles() {
    const coloredTabs = document.querySelectorAll(".workspace-tab-header.tab-colors-custom");
    coloredTabs.forEach((tab) => {
      tab.classList.remove("tab-colors-custom");
      tab.classList.remove("tab-colors-low-contrast");
      tab.style.removeProperty("--tab-colors-bg");
      tab.style.removeProperty("--tab-colors-text");
      tab.removeAttribute("title");
    });
    const blendedLeaves = document.querySelectorAll(".workspace-leaf.tab-colors-note-blend");
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
  resolveColorForFile(file) {
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
  getFolderRuleColor(file) {
    if (this.settings.folderColorRules.length === 0) {
      return null;
    }
    const parentPath = file.parent?.path;
    if (parentPath === void 0) return null;
    for (const rule of this.settings.folderColorRules) {
      let ruleFolder = rule.folder.trim();
      if (ruleFolder.startsWith("/")) ruleFolder = ruleFolder.slice(1);
      if (ruleFolder.endsWith("/")) ruleFolder = ruleFolder.slice(0, -1);
      if (ruleFolder === "" && (parentPath === "/" || parentPath === "")) {
        return rule.color;
      }
      if (parentPath === ruleFolder || parentPath.startsWith(ruleFolder + "/")) {
        return rule.color;
      }
    }
    return null;
  }
  getFrontmatterColor(file) {
    const configuredKey = this.settings.frontmatterColorKey.trim();
    if (!configuredKey) {
      return null;
    }
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter || typeof frontmatter !== "object") {
      return null;
    }
    const frontmatterMap = frontmatter;
    let rawValue = frontmatterMap[configuredKey];
    if (rawValue === void 0) {
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
  normalizeHexColorValue(value) {
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed) || /^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed;
    }
    if (/^[0-9a-fA-F]{3}$/.test(trimmed) || /^[0-9a-fA-F]{6}$/.test(trimmed)) {
      return `#${trimmed}`;
    }
    return null;
  }
  getTagRuleColor(file) {
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
  getFileTags(file) {
    const tags = /* @__PURE__ */ new Set();
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
  normalizeTag(tag) {
    const value = tag.trim().toLowerCase();
    if (!value) {
      return "";
    }
    return value.startsWith("#") ? value : `#${value}`;
  }
  applyGlobalBlendSettings() {
    const blendLength = this.clamp(Math.round(this.settings.blendLengthPx), 80, 600);
    const dotSize = this.clamp(this.settings.dotSizePx, 1, 8);
    const dotSpacing = this.clamp(this.settings.dotSpacingPx, 6, 40);
    document.body.style.setProperty("--tab-colors-blend-length", `${blendLength}px`);
    document.body.style.setProperty("--tab-colors-dot-size", `${dotSize}px`);
    document.body.style.setProperty("--tab-colors-dot-spacing", `${dotSpacing}px`);
  }
  applyLeafBlendStrengthVariables(leafContainerEl, color) {
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
    leafContainerEl.style.setProperty("--tab-colors-dot-color", `rgba(${r}, ${g}, ${b}, ${(0.3 * dotStrength).toFixed(3)})`);
  }
  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  getContrastingTextColor(color) {
    const report = this.getContrastReport(color);
    if (report) {
      return report.textColor;
    }
    return "#111111";
  }
  getContrastWarning(color) {
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
  getContrastReport(color) {
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
  getRelativeLuminance(r, g, b) {
    const channels = [r, g, b].map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }
  getContrastRatio(firstLuminance, secondLuminance) {
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }
  parseHexColor(color) {
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
  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = this.normalizeSettings(loaded);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  normalizeSettings(loaded) {
    const raw = loaded ?? {};
    const presetSource = Array.isArray(raw.presetColors) ? raw.presetColors : DEFAULT_PRESET_COLORS;
    const presetColors = presetSource.map((value, index) => this.normalizePreset(value, index)).filter((value) => value !== null);
    const tagRuleSource = Array.isArray(raw.tagColorRules) ? raw.tagColorRules : [];
    const tagColorRules = tagRuleSource.map((value) => this.normalizeTagRule(value)).filter((value) => value !== null);
    const folderRuleSource = Array.isArray(raw.folderColorRules) ? raw.folderColorRules : [];
    const folderColorRules = folderRuleSource.map((value) => this.normalizeFolderRule(value)).filter((value) => value !== null);
    const frontmatterColorKey = typeof raw.frontmatterColorKey === "string" && raw.frontmatterColorKey.trim().length > 0 ? raw.frontmatterColorKey.trim() : DEFAULT_SETTINGS.frontmatterColorKey;
    return {
      fileColors: raw.fileColors ?? {},
      presetColors: presetColors.length > 0 ? presetColors : DEFAULT_PRESET_COLORS.map((preset) => ({ ...preset })),
      tagColorRules,
      folderColorRules,
      frontmatterColorKey,
      accessibilityMode: Boolean(raw.accessibilityMode),
      minContrastRatio: this.clamp(Number(raw.minContrastRatio ?? DEFAULT_SETTINGS.minContrastRatio), 4.5, 12),
      blendLengthPx: this.clamp(Number(raw.blendLengthPx ?? DEFAULT_SETTINGS.blendLengthPx), 80, 600),
      blendIntensity: this.clamp(Number(raw.blendIntensity ?? DEFAULT_SETTINGS.blendIntensity), 0, 100),
      noteBackgroundEffect: this.normalizeNoteBackgroundEffect(raw.noteBackgroundEffect),
      dotSizePx: this.clamp(Number(raw.dotSizePx ?? DEFAULT_SETTINGS.dotSizePx), 1, 8),
      dotSpacingPx: this.clamp(Number(raw.dotSpacingPx ?? DEFAULT_SETTINGS.dotSpacingPx), 6, 40),
      dotIntensity: this.clamp(Number(raw.dotIntensity ?? DEFAULT_SETTINGS.dotIntensity), 0, 100)
    };
  }
  normalizeNoteBackgroundEffect(value) {
    if (value === "none" || value === "gradient" || value === "dots") {
      return value;
    }
    return DEFAULT_SETTINGS.noteBackgroundEffect;
  }
  normalizeTagRule(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const rule = value;
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
  normalizeFolderRule(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const rule = value;
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
  normalizePreset(value, index) {
    if (typeof value === "string" && value.length > 0) {
      return {
        name: `Preset ${index + 1}`,
        color: value
      };
    }
    if (value && typeof value === "object") {
      const candidate = value;
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
};
var TabColorsSettingTab = class extends import_obsidian.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Tab Colors" });
    new import_obsidian.Setting(containerEl).setName("Preset swatches").setDesc("These colors appear as quick-pick swatches in the tab color modal.");
    this.plugin.settings.presetColors.forEach((preset, index) => {
      new import_obsidian.Setting(containerEl).setName(`Preset ${index + 1}`).addText((text) => {
        text.setPlaceholder("Name").setValue(preset.name).onChange(async (value) => {
          this.plugin.settings.presetColors[index].name = value.trim() || `Preset ${index + 1}`;
          await this.plugin.saveData(this.plugin.settings);
        });
      }).addColorPicker((picker) => {
        picker.setValue(preset.color);
        picker.onChange(async (value) => {
          this.plugin.settings.presetColors[index].color = value;
          await this.plugin.saveData(this.plugin.settings);
        });
      }).addExtraButton((button) => {
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
    new import_obsidian.Setting(containerEl).addButton((button) => {
      button.setButtonText("Add preset").onClick(async () => {
        this.plugin.settings.presetColors.push({
          name: `Preset ${this.plugin.settings.presetColors.length + 1}`,
          color: "#3aa6ff"
        });
        await this.plugin.saveData(this.plugin.settings);
        this.display();
      });
    }).addButton((button) => {
      button.setButtonText("Reset defaults").onClick(async () => {
        this.plugin.settings.presetColors = DEFAULT_PRESET_COLORS.map((preset) => ({ ...preset }));
        await this.plugin.saveData(this.plugin.settings);
        this.display();
      });
    });
    containerEl.createEl("h3", { text: "Tag Auto Colors" });
    new import_obsidian.Setting(containerEl).setName("Tag color rules").setDesc("Auto-apply a tab color when a note includes a matching tag. Manual tab colors take priority.");
    this.plugin.settings.tagColorRules.forEach((rule, index) => {
      new import_obsidian.Setting(containerEl).setName(`Rule ${index + 1}`).addText((text) => {
        text.setPlaceholder("tag or #tag").setValue(rule.tag).onChange(async (value) => {
          this.plugin.settings.tagColorRules[index].tag = this.plugin.normalizeTag(value) || "#tag";
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
        });
      }).addColorPicker((picker) => {
        picker.setValue(rule.color);
        picker.onChange(async (value) => {
          this.plugin.settings.tagColorRules[index].color = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
        });
      }).addExtraButton((button) => {
        button.setIcon("trash").setTooltip("Remove rule").onClick(async () => {
          this.plugin.settings.tagColorRules.splice(index, 1);
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
          this.display();
        });
      });
    });
    new import_obsidian.Setting(containerEl).addButton((button) => {
      button.setButtonText("Add tag rule").onClick(async () => {
        this.plugin.settings.tagColorRules.push({ tag: "#topic", color: "#3aa6ff" });
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
        this.display();
      });
    });
    containerEl.createEl("h3", { text: "Folder Auto Colors" });
    new import_obsidian.Setting(containerEl).setName("Folder color rules").setDesc("Auto-apply a tab color when a note is inside a matching folder. Tag and manual colors take priority.");
    this.plugin.settings.folderColorRules.forEach((rule, index) => {
      new import_obsidian.Setting(containerEl).setName(`Rule ${index + 1}`).addText((text) => {
        text.setPlaceholder("Folder path (e.g. Journal)").setValue(rule.folder).onChange(async (value) => {
          this.plugin.settings.folderColorRules[index].folder = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
        });
      }).addColorPicker((picker) => {
        picker.setValue(rule.color);
        picker.onChange(async (value) => {
          this.plugin.settings.folderColorRules[index].color = value;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
        });
      }).addExtraButton((button) => {
        button.setIcon("trash").setTooltip("Remove rule").onClick(async () => {
          this.plugin.settings.folderColorRules.splice(index, 1);
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.applyAllTabColors();
          this.display();
        });
      });
    });
    new import_obsidian.Setting(containerEl).addButton((button) => {
      button.setButtonText("Add folder rule").onClick(async () => {
        this.plugin.settings.folderColorRules.push({ folder: "Folder", color: "#3aa6ff" });
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
        this.display();
      });
    });
    containerEl.createEl("h3", { text: "Frontmatter Auto Colors" });
    new import_obsidian.Setting(containerEl).setName("Frontmatter color key").setDesc("Use a frontmatter field for per-note tab color (hex only). Example: tabColor: '#3aa6ff'. Priority: manual > frontmatter > tag > folder.").addText((text) => {
      text.setPlaceholder("tabColor").setValue(this.plugin.settings.frontmatterColorKey).onChange(async (value) => {
        this.plugin.settings.frontmatterColorKey = value.trim() || DEFAULT_SETTINGS.frontmatterColorKey;
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
      });
    });
    containerEl.createEl("h3", { text: "Accessibility" });
    new import_obsidian.Setting(containerEl).setName("Accessibility mode").setDesc("Auto-pick the best text color and warn when a tab color is below your minimum contrast ratio.").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.accessibilityMode).onChange(async (value) => {
        this.plugin.settings.accessibilityMode = value;
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
        this.display();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Minimum contrast ratio").setDesc("Used only when Accessibility mode is enabled. Higher values are stricter.").addSlider((slider) => {
      slider.setLimits(4.5, 12, 0.5).setValue(this.plugin.settings.minContrastRatio).setDynamicTooltip();
      slider.onChange(async (value) => {
        this.plugin.settings.minContrastRatio = value;
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
      });
    });
    containerEl.createEl("h3", { text: "Note Blend" });
    new import_obsidian.Setting(containerEl).setName("Note background effect").setDesc("Choose how the note background reacts to the tab color.").addDropdown((dropdown) => {
      dropdown.addOption("none", "None").addOption("gradient", "Gradient").addOption("dots", "Dotted pattern").setValue(this.plugin.settings.noteBackgroundEffect).onChange(async (value) => {
        this.plugin.settings.noteBackgroundEffect = value;
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Blend intensity").setDesc("How strong the note background tint appears (0-100%).").addSlider((slider) => {
      slider.setLimits(0, 100, 1).setValue(this.plugin.settings.blendIntensity).setDynamicTooltip();
      slider.onChange(async (value) => {
        this.plugin.settings.blendIntensity = value;
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Blend length").setDesc("How far the gradient extends into the note pane in pixels (80-600). Used for gradient mode.").addSlider((slider) => {
      slider.setLimits(80, 600, 10).setValue(this.plugin.settings.blendLengthPx).setDynamicTooltip();
      slider.onChange(async (value) => {
        this.plugin.settings.blendLengthPx = value;
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyGlobalBlendSettings();
        this.plugin.applyAllTabColors();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Dot size").setDesc("Dot size in pixels for dotted mode.").addSlider((slider) => {
      slider.setLimits(1, 8, 1).setValue(this.plugin.settings.dotSizePx).setDynamicTooltip();
      slider.onChange(async (value) => {
        this.plugin.settings.dotSizePx = value;
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyGlobalBlendSettings();
        this.plugin.applyAllTabColors();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Dot spacing").setDesc("Distance between dots in pixels for dotted mode.").addSlider((slider) => {
      slider.setLimits(6, 40, 1).setValue(this.plugin.settings.dotSpacingPx).setDynamicTooltip();
      slider.onChange(async (value) => {
        this.plugin.settings.dotSpacingPx = value;
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyGlobalBlendSettings();
        this.plugin.applyAllTabColors();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Dot intensity").setDesc("How visible the dots are in dotted mode (0-100%).").addSlider((slider) => {
      slider.setLimits(0, 100, 1).setValue(this.plugin.settings.dotIntensity).setDynamicTooltip();
      slider.onChange(async (value) => {
        this.plugin.settings.dotIntensity = value;
        await this.plugin.saveData(this.plugin.settings);
        this.plugin.applyAllTabColors();
      });
    });
  }
};

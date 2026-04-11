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
  presetColors: [...DEFAULT_PRESET_COLORS]
};
var ColorPickerModal = class extends import_obsidian.Modal {
  result = null;
  selectedColor;
  onSubmit;
  presetColors;
  constructor(plugin, initialColor, presetColors, onSubmit) {
    super(plugin.app);
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
      });
    });
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
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TabColorsSettingTab(this.app, this));
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
  onunload() {
    this.clearAllTabStyles();
  }
  addTabColorMenuItems(menu, file, source, leaf) {
    const isLikelyTabContext = source.toLowerCase().includes("tab") || source.toLowerCase().includes("leaf");
    menu.addItem((item) => {
      item.setTitle("Set Tab Color").setIcon("palette").setSection("action").setChecked(Boolean(this.settings.fileColors[file.path])).onClick(() => {
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
      item.setTitle("Clear Tab Color").setIcon("paintbrush").setSection("action").setDisabled(!this.settings.fileColors[file.path]).onClick(async () => {
        delete this.settings.fileColors[file.path];
        await this.saveSettings();
        this.applyAllTabColors();
      });
    });
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
  applyAllTabColors() {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      this.applyTabColorForLeaf(leaf);
    }
  }
  applyTabColorForLeaf(leaf) {
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
  clearAllTabStyles() {
    const coloredTabs = document.querySelectorAll(".workspace-tab-header.tab-colors-custom");
    coloredTabs.forEach((tab) => {
      tab.classList.remove("tab-colors-custom");
      tab.style.removeProperty("--tab-colors-bg");
      tab.style.removeProperty("--tab-colors-text");
    });
  }
  getContrastingTextColor(color) {
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
    return {
      fileColors: raw.fileColors ?? {},
      presetColors: presetColors.length > 0 ? presetColors : DEFAULT_PRESET_COLORS.map((preset) => ({ ...preset }))
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
  }
};

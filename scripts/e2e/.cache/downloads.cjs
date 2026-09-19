var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/downloads.ts
var downloads_exports = {};
__export(downloads_exports, {
  cancelDownload: () => cancelDownload,
  inferCategory: () => inferCategory,
  initDownloads: () => initDownloads,
  isModelUrl: () => isModelUrl,
  listDownloads: () => listDownloads,
  modelBaseName: () => modelBaseName,
  pauseDownload: () => pauseDownload,
  resumeDownload: () => resumeDownload,
  startDownload: () => startDownload
});
module.exports = __toCommonJS(downloads_exports);
var import_electron3 = require("electron");
var import_node_fs4 = __toESM(require("node:fs"));
var import_node_path4 = __toESM(require("node:path"));
var import_node_http = __toESM(require("node:http"));
var import_node_https = __toESM(require("node:https"));
var import_node_crypto = __toESM(require("node:crypto"));

// src/main/settings.ts
var import_electron = require("electron");
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));

// src/shared/advArgs.ts
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
function num(v) {
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function buildAdvancedArgs(a) {
  if (!a) return [];
  const out = [];
  const flag = (key, name) => {
    if (a[key]) out.push(name);
  };
  const tri = (key, onFlag, offFlag) => {
    if (a[key] === "on") out.push(onFlag);
    else if (a[key] === "off") out.push(offFlag);
  };
  flag("listen", "--listen");
  flag("enableCors", "--enable-cors-header");
  const maxUpload = num(a.maxUploadSize);
  if (maxUpload && maxUpload !== 100) out.push("--max-upload-size", String(maxUpload));
  flag("compressResponse", "--enable-compress-response-body");
  tri("autoLaunch", "--auto-launch", "--disable-auto-launch");
  const cudaDevice = str(a.cudaDevice);
  if (cudaDevice) out.push("--cuda-device", cudaDevice);
  flag("directml", "--directml");
  tri("cudaMalloc", "--cuda-malloc", "--disable-cuda-malloc");
  if (a.forceFp === "fp32") out.push("--force-fp32");
  else if (a.forceFp === "fp16") out.push("--force-fp16");
  const unet = str(a.unetPrecision);
  if (unet) out.push(`--${unet}-unet`);
  const vae = str(a.vaePrecision);
  if (vae) out.push(`--${vae}-vae`);
  const textEnc = str(a.textEncPrecision);
  if (textEnc) out.push(`--${textEnc}-text-enc`);
  flag("fp16Intermediates", "--fp16-intermediates");
  const previewMethod = str(a.previewMethod);
  if (previewMethod) out.push("--preview-method", previewMethod);
  const previewSize = num(a.previewSize);
  if (previewSize && previewSize !== 512) out.push("--preview-size", String(previewSize));
  if (a.cache === "none") out.push("--cache-none");
  else if (a.cache === "classic") out.push("--cache-classic");
  else if (a.cache === "lru") {
    const n = num(a.cacheLruN);
    out.push("--cache-lru", String(n ?? 3));
  }
  const attention = str(a.attention);
  if (attention === "sage") out.push("--use-sage-attention");
  else if (attention === "flash") out.push("--use-flash-attention");
  else if (attention) out.push(`--use-${attention}-cross-attention`);
  flag("disableXformers", "--disable-xformers");
  tri("upcastAttention", "--force-upcast-attention", "--dont-upcast-attention");
  const vramMode = str(a.vramMode);
  if (vramMode) out.push(`--${vramMode}`);
  const reserveVram = num(a.reserveVram);
  if (reserveVram) out.push("--reserve-vram", String(reserveVram));
  tri("asyncOffload", "--async-offload", "--disable-async-offload");
  tri("dynamicVram", "--enable-dynamic-vram", "--disable-dynamic-vram");
  flag("fastDisk", "--fast-disk");
  flag("disableSmartMemory", "--disable-smart-memory");
  flag("disablePinnedMemory", "--disable-pinned-memory");
  tri("mmap", "--mmap-torch-files", "--disable-mmap");
  flag("fast", "--fast");
  flag("deterministic", "--deterministic");
  const hashFn = str(a.hashFunction);
  if (hashFn && hashFn !== "sha256") out.push("--default-hashing-function", hashFn);
  flag("enableManager", "--enable-manager");
  if (a.enableManager) {
    flag("disableManagerUi", "--disable-manager-ui");
    flag("managerLegacyUi", "--enable-manager-legacy-ui");
  }
  flag("disableAllCustomNodes", "--disable-all-custom-nodes");
  flag("disableApiNodes", "--disable-api-nodes");
  flag("disableMetadata", "--disable-metadata");
  flag("multiUser", "--multi-user");
  const verbose = str(a.verbose);
  if (verbose) out.push("--verbose", verbose);
  flag("logStdout", "--log-stdout");
  flag("dontPrintServer", "--dont-print-server");
  return out;
}

// src/main/settings.ts
var defaults = {
  installPath: "",
  comfyVersion: "master",
  pythonVersion: "",
  pythonPath: "",
  gitMirror: "gitcode",
  customRepoUrl: "",
  gitProxyPrefix: "",
  pipMirror: "tuna",
  torchIndex: "auto",
  torchMirror: "aliyun",
  modelPath: "",
  // 界面已内嵌到启动器，默认不再自动打开浏览器（可在「设置」改回 --auto-launch）
  launchArgs: "--disable-auto-launch",
  advArgs: { enableManager: true },
  port: 8188,
  hfMirror: true,
  vramModeAutoApplied: false,
  autoLaunchOffMigrated: false,
  theme: "",
  locale: ""
};
var PIP_MIRRORS = {
  default: "",
  tuna: "https://pypi.tuna.tsinghua.edu.cn/simple",
  aliyun: "https://mirrors.aliyun.com/pypi/simple/",
  ustc: "https://mirrors.ustc.edu.cn/pypi/simple"
};
var cache = null;
function settingsFile() {
  return import_node_path.default.join(import_electron.app.getPath("userData"), "settings.json");
}
function migrateAdvIntoLaunch(s) {
  const gen = buildAdvancedArgs(s.advArgs);
  if (!gen.length) return;
  const tokens = s.launchArgs.split(/\s+/).filter(Boolean);
  const merged = [...tokens];
  for (let i = 0; i < gen.length; i++) {
    const t2 = gen[i];
    if (!t2.startsWith("--")) continue;
    const value = gen[i + 1] !== void 0 && !gen[i + 1].startsWith("--") ? gen[i + 1] : null;
    if (value !== null) i++;
    if (merged.includes(t2)) continue;
    merged.push(t2);
    if (value !== null) merged.push(value);
  }
  s.launchArgs = merged.join(" ");
}
function migrateAutoLaunchOff(s) {
  if (s.autoLaunchOffMigrated) return false;
  const tokens = s.launchArgs.split(/\s+/).filter(Boolean);
  if (!tokens.includes("--auto-launch") && !tokens.includes("--disable-auto-launch")) {
    s.launchArgs = ["--disable-auto-launch", ...tokens].join(" ");
  }
  s.autoLaunchOffMigrated = true;
  return true;
}
function loadSettings() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(import_node_fs.default.readFileSync(settingsFile(), "utf-8"));
    const merged = { ...defaults, ...raw };
    migrateAdvIntoLaunch(merged);
    const persist2 = migrateAutoLaunchOff(merged);
    cache = merged;
    if (persist2) {
      try {
        import_node_fs.default.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), "utf-8");
      } catch {
      }
    }
  } catch {
    cache = { ...defaults };
  }
  return cache;
}
function saveSettings(s) {
  cache = { ...loadSettings(), ...s };
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(settingsFile()), { recursive: true });
  import_node_fs.default.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), "utf-8");
  return cache;
}
function defaultRoot() {
  if (import_electron.app.isPackaged) return import_node_path.default.join(import_node_path.default.dirname(import_electron.app.getPath("exe")), "ComfyUI-Runtime");
  return import_node_path.default.join(import_electron.app.getPath("documents"), "ComfyUI-Runtime");
}
function paths(s = loadSettings()) {
  const root = s.installPath || defaultRoot();
  const comfy2 = import_node_path.default.join(root, "ComfyUI");
  return {
    root,
    comfy: comfy2,
    venv: import_node_path.default.join(root, ".venv"),
    venvPython: import_node_path.default.join(root, ".venv", "Scripts", "python.exe"),
    venvScripts: import_node_path.default.join(root, ".venv", "Scripts"),
    customNodes: import_node_path.default.join(comfy2, "custom_nodes"),
    models: s.modelPath || import_node_path.default.join(comfy2, "models"),
    workflows: import_node_path.default.join(comfy2, "user", "default", "workflows")
  };
}
function isInstalled() {
  const p = paths();
  return import_node_fs.default.existsSync(import_node_path.default.join(p.comfy, "main.py"));
}

// src/main/process.ts
var import_node_child_process2 = require("node:child_process");
var import_node_fs3 = __toESM(require("node:fs"));
var import_node_net = __toESM(require("node:net"));
var import_node_path3 = __toESM(require("node:path"));
var import_node_events = require("node:events");

// src/main/util.ts
var import_node_child_process = require("node:child_process");
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = (0, import_node_child_process.spawn)(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true
    });
    let out = "";
    let err = "";
    let settled = false;
    const timer = opts.timeoutMs ? setTimeout(() => {
      settled = true;
      killTree(child.pid);
      resolve({ code: -1, out, err: err + "\n[timeout]" });
    }, opts.timeoutMs) : null;
    child.stdout?.on("data", (d) => {
      const s = d.toString();
      out += s;
      opts.onData?.(s);
    });
    child.stderr?.on("data", (d) => {
      const s = d.toString();
      err += s;
      opts.onData?.(s);
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (!settled) resolve({ code: code ?? -1, out, err });
    });
  });
}
function killTree(pid) {
  if (!pid) return;
  try {
    (0, import_node_child_process.execFile)("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {
    });
  } catch {
  }
}
function splitArgs(s) {
  const m = s.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return m.map((x) => x.replace(/^["']|["']$/g, ""));
}

// src/shared/i18n/locales/common.ts
var common_default = {
  "common.cancel": ["\u53D6\u6D88", "Cancel"],
  "common.confirm": ["\u786E\u5B9A", "OK"],
  "common.save": ["\u4FDD\u5B58", "Save"],
  "common.saved": ["\u5DF2\u4FDD\u5B58", "Saved"],
  "common.delete": ["\u5220\u9664", "Delete"],
  "common.remove": ["\u79FB\u9664", "Remove"],
  "common.refresh": ["\u5237\u65B0", "Refresh"],
  "common.close": ["\u5173\u95ED", "Close"],
  "common.open": ["\u6253\u5F00", "Open"],
  "common.reveal": ["\u5B9A\u4F4D", "Reveal"],
  "common.browse": ["\u6D4F\u89C8", "Browse"],
  "common.copy": ["\u590D\u5236", "Copy"],
  "common.retry": ["\u91CD\u8BD5", "Retry"],
  "common.loading": ["\u52A0\u8F7D\u4E2D\u2026", "Loading\u2026"],
  "common.empty": ["\u6682\u65E0\u6570\u636E", "No data"],
  "common.unknown": ["\u672A\u77E5", "Unknown"],
  "common.failed": ["\u64CD\u4F5C\u5931\u8D25", "Operation failed"],
  "common.notInstalled": ["\u672A\u5B89\u88C5", "Not installed"],
  "common.installed": ["\u5DF2\u5B89\u88C5", "Installed"],
  "common.name": ["\u540D\u79F0", "Name"],
  "common.size": ["\u5927\u5C0F", "Size"],
  "common.status": ["\u72B6\u6001", "Status"],
  "common.actions": ["\u64CD\u4F5C", "Actions"],
  "common.path": ["\u8DEF\u5F84", "Path"]
};

// src/shared/i18n/locales/app.ts
var app_default = {
  "app.title": ["ComfyUI \u684C\u9762\u7BA1\u5BB6", "ComfyUI Desk"],
  "app.subtitle": ["\u4E00\u7AD9\u5F0F\u7BA1\u7406\u5DE5\u5177", "All-in-one manager"],
  "app.status.stopped": ["\u5DF2\u505C\u6B62", "Stopped"],
  "app.status.starting": ["\u542F\u52A8\u4E2D", "Starting"],
  "app.status.running": ["\u8FD0\u884C\u4E2D", "Running"],
  "app.status.error": ["\u9519\u8BEF", "Error"],
  "app.logStartup": ["[\u7BA1\u5BB6] ComfyUI \u684C\u9762\u7BA1\u5BB6 v{version} \u542F\u52A8", "[Desk] ComfyUI Desk v{version} started"],
  "app.error.title": ["ComfyUI \u8FD0\u884C\u5F02\u5E38", "ComfyUI failed to run"],
  "app.error.viewLogs": ["\u67E5\u770B\u65E5\u5FD7", "View logs"],
  "app.error.dismiss": ["\u77E5\u9053\u4E86", "Got it"],
  "app.toast.downloadTaken": ["\u5DF2\u5F00\u59CB\u4E0B\u8F7D {filename}\uFF0C\u5DF2\u8DF3\u8F6C\u5230\u6A21\u578B\u7BA1\u7406", "Downloading {filename}, switched to Models"]
};

// src/shared/i18n/locales/nav.ts
var nav_default = {
  "nav.dashboard": ["\u4EEA\u8868\u76D8", "Dashboard"],
  "nav.workbench": ["\u5DE5\u4F5C\u53F0", "Workbench"],
  "nav.install": ["\u5B89\u88C5", "Install"],
  "nav.logs": ["\u65E5\u5FD7", "Logs"],
  "nav.terminal": ["\u7EC8\u7AEF", "Terminal"],
  "nav.models": ["\u6A21\u578B\u7BA1\u7406", "Models"],
  "nav.nodes": ["\u8282\u70B9\u7BA1\u7406", "Nodes"],
  "nav.workflows": ["\u5DE5\u4F5C\u6D41", "Workflows"],
  "nav.tools": ["\u8BCA\u65AD", "Diagnostics"],
  "nav.settings": ["\u8BBE\u7F6E", "Settings"],
  "nav.about": ["\u5173\u4E8E", "About"],
  "nav.collapse": ["\u6536\u8D77\u4FA7\u8FB9\u680F", "Collapse sidebar"],
  "nav.expand": ["\u5C55\u5F00\u4FA7\u8FB9\u680F", "Expand sidebar"],
  "nav.theme.toDark": ["\u5207\u6362\u5230\u6DF1\u8272\u4E3B\u9898", "Switch to dark theme"],
  "nav.theme.toLight": ["\u5207\u6362\u5230\u4EAE\u8272\u4E3B\u9898", "Switch to light theme"],
  "nav.theme.dark": ["\u6DF1\u8272", "Dark"],
  "nav.theme.light": ["\u4EAE\u8272", "Light"],
  "nav.lang.toZh": ["\u5207\u6362\u5230\u4E2D\u6587", "Switch to \u4E2D\u6587"],
  "nav.lang.toEn": ["\u5207\u6362\u5230 English", "Switch to English"]
};

// src/shared/i18n/locales/store.ts
var store_default = {
  "store.cpuEdition": ["CPU \u7248", "CPU"]
};

// src/shared/i18n/locales/dashboard.ts
var dashboard_default = {
  "dash.title": ["\u4EEA\u8868\u76D8", "Dashboard"],
  "dash.desc": ["\u67E5\u770B ComfyUI \u8FD0\u884C\u72B6\u6001\u5E76\u8FDB\u884C\u542F\u52A8 / \u5173\u95ED / \u91CD\u542F\u64CD\u4F5C", "View ComfyUI status and start, stop, or restart it"],
  "dash.notInstalled": ["\u5C1A\u672A\u5B89\u88C5 ComfyUI", "ComfyUI is not installed yet"],
  "dash.notInstalledHint": [
    "\u524D\u5F80\u5B89\u88C5\u9875\u4E00\u952E\u90E8\u7F72\uFF0C\u6216\u9009\u62E9\u7535\u8111\u4E0A\u5DF2\u6709\u7684 ComfyUI \u76EE\u5F55",
    "Deploy it in one click on the Install page, or select an existing ComfyUI folder on this computer"
  ],
  "dash.installNow": ["\u7ACB\u5373\u5B89\u88C5", "Install now"],
  "dash.pickExisting": ["\u9009\u62E9\u5DF2\u5B89\u88C5\u76EE\u5F55", "Select installed folder"],
  "dash.status.stopped": ["\u5DF2\u505C\u6B62", "Stopped"],
  "dash.status.starting": ["\u542F\u52A8\u4E2D\u2026", "Starting\u2026"],
  "dash.status.running": ["\u8FD0\u884C\u4E2D", "Running"],
  "dash.status.error": ["\u8FD0\u884C\u9519\u8BEF", "Error"],
  "dash.openGui": ["\u6253\u5F00 ComfyUI \u754C\u9762", "Open ComfyUI interface"],
  "dash.start": ["\u542F\u52A8", "Start"],
  "dash.restart": ["\u91CD\u542F", "Restart"],
  "dash.stop": ["\u5173\u95ED", "Stop"],
  "dash.pickedOk": ["\u5DF2\u8BC6\u522B\u5B89\u88C5\u76EE\u5F55\uFF0C\u53EF\u4EE5\u542F\u52A8 ComfyUI", "Installation folder detected. You can start ComfyUI now"],
  "dash.pickedNoEnv": [
    "\u5DF2\u8BC6\u522B\u5B89\u88C5\u76EE\u5F55\uFF1B\u8FD0\u884C\u73AF\u5883\u7F3A\u5931\uFF0C\u542F\u52A8\u524D\u8BF7\u5230\u300C\u8BCA\u65AD\u300D\u9875\u6267\u884C\u73AF\u5883\u4FEE\u590D",
    "Installation folder detected, but the runtime environment is missing. Run the environment repair on the Diagnostics page before starting"
  ],
  "dash.updateDone": ["\u66F4\u65B0\u5B8C\u6210", "Update complete"],
  "dash.switchDone": ["Torch \u5207\u6362\u5B8C\u6210\uFF0C\u91CD\u542F ComfyUI \u540E\u751F\u6548", "Torch switched. Restart ComfyUI to apply"],
  "dash.version": ["ComfyUI \u7248\u672C", "ComfyUI version"],
  "dash.gpu": ["\u663E\u5361", "GPU"],
  "dash.gpuNone": ["\u672A\u68C0\u6D4B\u5230", "Not detected"],
  "dash.driver": ["\u9A71\u52A8\u7248\u672C", "Driver version"],
  "dash.installPath": ["\u5B89\u88C5\u8DEF\u5F84", "Install path"],
  "dash.openDir": ["\u6253\u5F00\u76EE\u5F55", "Open folder"],
  "dash.updateTitle": ["\u66F4\u65B0 ComfyUI", "Update ComfyUI"],
  "dash.checking": ["\u68C0\u67E5\u4E2D\u2026", "Checking\u2026"],
  "dash.checkUpdate": ["\u68C0\u67E5\u66F4\u65B0", "Check for updates"],
  "dash.updating": ["\u66F4\u65B0\u4E2D\u2026", "Updating\u2026"],
  "dash.updateTo": ["\u66F4\u65B0\u5230 {version}", "Update to {version}"],
  "dash.update": ["\u66F4\u65B0", "Update"],
  "dash.hasUpdate": ["\u53D1\u73B0\u65B0\u7248\u672C {latest}\uFF08\u5F53\u524D {current}\uFF09", "New version {latest} available (current {current})"],
  "dash.isLatest": ["\u5DF2\u662F\u6700\u65B0\u7248\u672C\uFF08{current}\uFF09", "Already up to date ({current})"],
  "dash.checkHint": ["\u70B9\u51FB\u300C\u68C0\u67E5\u66F4\u65B0\u300D\u68C0\u6D4B\u662F\u5426\u6709\u65B0\u7248\u672C", 'Click "Check for updates" to look for a new version'],
  "dash.switchTitle": ["\u5207\u6362 Torch / CUDA", "Switch Torch / CUDA"],
  "dash.selectVersion": ["\u9009\u62E9\u7248\u672C", "Select version"],
  "dash.switch": ["\u5207\u6362", "Switch"],
  "dash.switchHint": ["\u91CD\u88C5\u5339\u914D\u7684 torch / torchvision / torchaudio", "Reinstall matching torch / torchvision / torchaudio"]
};

// src/shared/i18n/locales/workbench.ts
var workbench_default = {
  "wb.title": ["\u5DE5\u4F5C\u53F0", "Workbench"],
  "wb.status.stopped": ["\u5DF2\u505C\u6B62", "Stopped"],
  "wb.status.starting": ["\u542F\u52A8\u4E2D\u2026", "Starting\u2026"],
  "wb.status.running": ["\u8FD0\u884C\u4E2D", "Running"],
  "wb.status.error": ["\u8FD0\u884C\u9519\u8BEF", "Run error"],
  "wb.openInBrowser": ["\u5728\u6D4F\u89C8\u5668\u6253\u5F00", "Open in browser"],
  "wb.fullscreen": ["\u5168\u5C4F", "Fullscreen"],
  "wb.exitFullscreen": ["\u9000\u51FA\u5168\u5C4F (Esc)", "Exit fullscreen (Esc)"],
  "wb.loading": ["ComfyUI \u754C\u9762\u52A0\u8F7D\u4E2D\u2026", "Loading the ComfyUI interface\u2026"],
  "wb.notInstalledTitle": ["\u5C1A\u672A\u5B89\u88C5 ComfyUI", "ComfyUI is not installed yet"],
  "wb.notInstalledDesc": ["\u5B89\u88C5\u5B8C\u6210\u540E\u5373\u53EF\u5728\u6B64\u76F4\u63A5\u4F7F\u7528 ComfyUI \u754C\u9762", "Once installed, you can use the ComfyUI interface right here"],
  "wb.installNow": ["\u7ACB\u5373\u5B89\u88C5", "Install now"],
  "wb.notRunningTitle": ["ComfyUI \u672A\u5728\u8FD0\u884C", "ComfyUI is not running"],
  "wb.notRunningDesc": ["\u542F\u52A8\u540E\uFF0C\u754C\u9762\u5C06\u76F4\u63A5\u663E\u793A\u5728\u8FD9\u91CC", "Once started, the interface will show up right here"],
  "wb.goStart": ["\u53BB\u542F\u52A8", "Start now"],
  "wb.crashed": ["\u754C\u9762\u8FDB\u7A0B\u5F02\u5E38\uFF0C\u6B63\u5728\u81EA\u52A8\u6062\u590D\u2026", "Interface process crashed, recovering automatically\u2026"],
  "wb.reloadRebuild": ["webview \u91CD\u8F7D\u5F02\u5E38\uFF0C\u5F3A\u5236\u91CD\u5EFA", "webview reload failed, forcing rebuild"],
  "wb.loadFailed": ["ComfyUI \u754C\u9762\u52A0\u8F7D\u5931\u8D25\uFF1A{msg}", "Failed to load the ComfyUI interface: {msg}"],
  "wb.loadFailedUnknown": ["\u672A\u77E5\u9519\u8BEF", "Unknown error"],
  "wb.dm.log": ["\u63A5\u7BA1[{source}] file={filename} cat={category} url={url}", "Takeover [{source}] file={filename} cat={category} url={url}"],
  "wb.dm.logNoCategory": ["(\u65E0)", "(none)"],
  "wb.dm.addFailed": ["\u52A0\u5165\u4E0B\u8F7D\u5931\u8D25\uFF1A{msg}", "Failed to add download: {msg}"],
  "wb.dm.patchUnsupported": ["\u754C\u9762\u4E0B\u8F7D\u62E6\u622A\u4E0D\u53EF\u7528\uFF1Awebview \u4E0D\u652F\u6301\u811A\u672C\u6CE8\u5165\uFF08\u53EA\u6709\u4E3B\u8FDB\u7A0B\u515C\u5E95\uFF0C\u76EE\u5F55\u6309 URL \u5173\u952E\u8BCD\u63A8\u65AD\uFF09", "In-app download interception unavailable: webview does not support script injection (main-process fallback only, folder inferred from URL keywords)"],
  "wb.dm.patchLoadFailed": ["\u754C\u9762\u4E0B\u8F7D\u62E6\u622A\u52A0\u8F7D\u5931\u8D25\uFF1A{msg}", "Failed to load in-app download interception: {msg}"],
  "wb.dm.takenTip": ["\u754C\u9762\u5185\u7684\u6A21\u578B\u4E0B\u8F7D\u5DF2\u7531\u7BA1\u5BB6\u63A5\u7BA1", "Model downloads inside the interface are handled by the manager"],
  "wb.dm.taken": ["\u2B07 \u63A5\u7BA1", "\u2B07 Managed"]
};

// src/shared/i18n/locales/install.ts
var install_default = {
  "install.title": ["\u5B89\u88C5", "Install"],
  "install.pageTitle": ["\u5B89\u88C5 ComfyUI", "Install ComfyUI"],
  "install.desc": [
    "\u9009\u62E9 Python \u7248\u672C\u3001ComfyUI \u7248\u672C\u4E0E\u5B89\u88C5\u8DEF\u5F84\uFF0C\u4E00\u952E\u5B8C\u6210\u90E8\u7F72\uFF08\u542B Torch \u4E0E\u5168\u90E8\u4F9D\u8D56\uFF09",
    "Pick a Python interpreter, ComfyUI version and install path to deploy in one click (Torch and all dependencies included)"
  ],
  "install.basicConfig": ["\u57FA\u7840\u914D\u7F6E", "Basic setup"],
  "install.pythonLabel": ["Python \u89E3\u91CA\u5668", "Python interpreter"],
  "install.noPython": ["\u672A\u68C0\u6D4B\u5230 Python", "No Python detected"],
  "install.pythonHint": [
    "\u5C06\u57FA\u4E8E\u8BE5\u89E3\u91CA\u5668\u521B\u5EFA\u72EC\u7ACB\u865A\u62DF\u73AF\u5883\uFF0C\u4E0D\u6C61\u67D3\u7CFB\u7EDF\u73AF\u5883",
    "Creates an isolated virtual environment from this interpreter, leaving the system environment untouched"
  ],
  "install.versionLabel": ["ComfyUI \u7248\u672C", "ComfyUI version"],
  "install.versionFail": ["\u83B7\u53D6\u7248\u672C\u5217\u8868\u5931\u8D25", "Failed to load versions"],
  "install.pathLabel": ["\u5B89\u88C5\u8DEF\u5F84", "Install path"],
  "install.pathPlaceholder": ["\u4F8B\u5982 D:\\AI\\ComfyUI", "e.g. D:\\AI\\ComfyUI"],
  "install.pathHint": [
    "\u9ED8\u8BA4\u5B89\u88C5\u5230\u7A0B\u5E8F\u76EE\u5F55\u4E0B\u7684 ComfyUI-Runtime\uFF0C\u53EF\u66F4\u6539\u4E3A\u4EFB\u610F\u4F4D\u7F6E",
    "Installs to ComfyUI-Runtime under the app folder by default; you can change it to any location"
  ],
  "install.torchVersion": ["Torch \u7248\u672C", "Torch version"],
  "install.torchAuto": [
    "\u81EA\u52A8\u63A8\u8350\uFF08NVIDIA \u9009\u6700\u65B0 CUDA\uFF0C\u5426\u5219 CPU\uFF09",
    "Recommended automatically (latest CUDA for NVIDIA, CPU otherwise)"
  ],
  "install.installing": ["\u5B89\u88C5\u4E2D\u2026", "Installing\u2026"],
  "install.start": ["\u5F00\u59CB\u5B89\u88C5", "Install"],
  "install.redetect": ["\u91CD\u65B0\u68C0\u6D4B", "Detect again"],
  "install.hardware": ["\u786C\u4EF6\u68C0\u6D4B", "Hardware detection"],
  "install.driverVersion": ["\u9A71\u52A8\u7248\u672C {v}", "Driver {v}"],
  "install.noGpu": ["\u672A\u68C0\u6D4B\u5230\u663E\u5361\uFF0C\u53EF\u70B9\u51FB\u300C\u91CD\u65B0\u68C0\u6D4B\u300D", 'No GPU detected \u2014 click "Detect again"'],
  "install.done": [
    "\u5B89\u88C5\u5B8C\u6210\uFF01\u56DE\u5230\u4EEA\u8868\u76D8\u5373\u53EF\u542F\u52A8 ComfyUI\u3002",
    "Installation complete! Go back to the dashboard to start ComfyUI."
  ],
  "install.stagePreparing": ["\u51C6\u5907", "Preparing"]
};

// src/shared/i18n/locales/logs.ts
var logs_default = {
  "logs.title": ["\u65E5\u5FD7", "Logs"],
  "logs.pageTitle": ["\u8FD0\u884C\u65E5\u5FD7", "Runtime logs"],
  "logs.desc": [
    "\u5B9E\u65F6\u663E\u793A ComfyUI \u8FDB\u7A0B\u7684\u8F93\u51FA\uFF08stdout / stderr / \u7CFB\u7EDF\u4E8B\u4EF6\uFF09",
    "Live output from the ComfyUI process (stdout / stderr / system events)"
  ],
  "logs.filterPlaceholder": ["\u8FC7\u6EE4\u5173\u952E\u5B57...", "Filter keywords..."],
  "logs.streamAll": ["\u5168\u90E8", "All"],
  "logs.streamSys": ["\u7CFB\u7EDF", "System"],
  "logs.autoScroll": ["\u81EA\u52A8\u6EDA\u52A8", "Auto-scroll"],
  "logs.copyAll": ["\u590D\u5236\u5168\u90E8", "Copy all"],
  "logs.clearView": ["\u6E05\u7A7A\u89C6\u56FE", "Clear view"],
  "logs.empty": ["\u6682\u65E0\u65E5\u5FD7", "No logs yet"]
};

// src/shared/i18n/locales/terminal.ts
var terminal_default = {
  "term.title": ["\u7EC8\u7AEF", "Terminal"],
  "term.desc": [
    "\u4EA4\u4E92\u5F0F\u7EC8\u7AEF\uFF08{shell}\uFF09 \u2014 \u5DF2\u81EA\u52A8\u52A0\u8F7D ComfyUI \u8FD0\u884C\u73AF\u5883\uFF08venv / git \u5747\u5DF2\u5728 PATH \u4E2D\uFF09",
    "Interactive terminal ({shell}) \u2014 ComfyUI runtime loaded (venv / git already on PATH)"
  ],
  "term.descNoShell": [
    "\u4EA4\u4E92\u5F0F\u7EC8\u7AEF \u2014 \u5DF2\u81EA\u52A8\u52A0\u8F7D ComfyUI \u8FD0\u884C\u73AF\u5883\uFF08venv / git \u5747\u5DF2\u5728 PATH \u4E2D\uFF09",
    "Interactive terminal \u2014 ComfyUI runtime loaded (venv / git already on PATH)"
  ],
  "term.exited": [
    "[\u4F1A\u8BDD\u5DF2\u9000\u51FA (code {code})\uFF0C\u6309\u56DE\u8F66\u5F00\u542F\u65B0\u4F1A\u8BDD]",
    "[Session exited (code {code}), press Enter to start a new session]"
  ]
};

// src/shared/i18n/locales/models.ts
var models_default = {
  "models.title": ["\u6A21\u578B\u7BA1\u7406", "Models"],
  "models.desc": ["\u67E5\u770B\u5DF2\u4E0B\u8F7D\u6A21\u578B\u3001\u6309\u7C7B\u522B\u7BA1\u7406\uFF0C\u652F\u6301\u76F4\u63A5\u4E0B\u8F7D\uFF08\u542B HF \u56FD\u5185\u955C\u50CF\u9002\u914D\uFF09", "Browse downloaded models by category and download new ones (HF mirror supported)"],
  "models.dl.title": ["\u4E0B\u8F7D\u6A21\u578B", "Download models"],
  "models.dl.urlPlaceholder": ["\u7C98\u8D34\u6A21\u578B\u94FE\u63A5\uFF08\u76F4\u94FE\u6216\u6A21\u578B\u9875\u9762\u94FE\u63A5\u5747\u53EF\uFF0C\u81EA\u52A8\u8F6C\u76F4\u94FE\uFF09", "Paste a model link (direct or model page link, converted automatically)"],
  "models.dl.namePlaceholder": ["\u6587\u4EF6\u540D\uFF08\u7559\u7A7A\u81EA\u52A8\uFF09", "Filename (auto if blank)"],
  "models.dl.hfMirror": ["HF \u955C\u50CF", "HF mirror"],
  "models.dl.add": ["\u6DFB\u52A0\u4E0B\u8F7D", "Add download"],
  "models.dl.hint": ["\u6A21\u578B\u4FDD\u5B58\u5230\u5BF9\u5E94\u7C7B\u522B\u76EE\u5F55\uFF1Bhuggingface.co \u52FE\u9009\u300CHF \u955C\u50CF\u300D\u8D70 hf-mirror.com\uFF1B\u5DE5\u4F5C\u53F0\u754C\u9762\u91CC\u70B9\u300C\u4E0B\u8F7D\u300D\u4E5F\u4F1A\u81EA\u52A8\u52A0\u5165\u8FD9\u91CC", 'Models are saved to their category folder. For huggingface.co, check "HF mirror" to use hf-mirror.com. Downloads started in the workbench are added here automatically.'],
  "models.dlList.title": ["\u4E0B\u8F7D\u7BA1\u7406", "Downloads"],
  "models.status.downloading": ["\u4E0B\u8F7D\u4E2D", "Downloading"],
  "models.status.paused": ["\u5DF2\u6682\u505C", "Paused"],
  "models.status.completed": ["\u5DF2\u5B8C\u6210", "Completed"],
  "models.status.error": ["\u51FA\u9519", "Error"],
  "models.dl.pct": ["\u4E0B\u8F7D\u4E2D {p}%", "Downloading {p}%"],
  "models.pause": ["\u6682\u505C", "Pause"],
  "models.resume": ["\u7EE7\u7EED", "Resume"],
  "models.confirmDelete": ["\u786E\u8BA4\u5220\u9664\u6A21\u578B\u6587\u4EF6\uFF1F\n{path}", "Delete this model file?\n{path}"],
  "models.toast.deleted": ["\u5DF2\u5220\u9664 {name}", "Deleted {name}"],
  "models.toast.done": ["\u4E0B\u8F7D\u5B8C\u6210\uFF1A{name}", "Download complete: {name}"],
  "models.library": ["\u6A21\u578B\u5E93", "Model library"],
  "models.scanning": ["\u626B\u63CF\u4E2D\u2026", "Scanning\u2026"],
  "models.col.file": ["\u6587\u4EF6\u540D", "File"],
  "models.col.date": ["\u65E5\u671F", "Date"],
  "models.col.relPath": ["\u76F8\u5BF9\u8DEF\u5F84", "Relative path"],
  "models.empty.cat": ["\u8BE5\u7C7B\u522B\u6682\u65E0\u6A21\u578B\u6587\u4EF6", "No model files in this category"],
  "models.empty.dir": ["\u672A\u627E\u5230\u6A21\u578B\u76EE\u5F55\uFF08\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u300C\u6A21\u578B\u4E0B\u8F7D\u8DEF\u5F84\u300D\uFF09", 'Model folder not found (set "Model download path" in Settings first)']
};

// src/shared/i18n/locales/nodes.ts
var nodes_default = {
  "nodes.title": ["\u8282\u70B9\u7BA1\u7406", "Nodes"],
  "nodes.desc": ["\u5B89\u88C5\u3001\u66F4\u65B0\u3001\u5220\u9664\u81EA\u5B9A\u4E49\u8282\u70B9\uFF1B\u5B89\u88C5\u540E\u81EA\u52A8\u5904\u7406\u4F9D\u8D56", "Install, update, and remove custom nodes; dependencies are handled automatically after install"],
  "nodes.install.title": ["\u5B89\u88C5\u8282\u70B9", "Install node"],
  "nodes.install.placeholder": ["\u7C98\u8D34 git \u4ED3\u5E93\u5730\u5740\uFF08\u5982 https://github.com/xxx/ComfyUI-XXX\uFF09", "Paste a git repository URL (e.g. https://github.com/xxx/ComfyUI-XXX)"],
  "nodes.install.proxyHint": ["node \u6765\u6E90\u4E3A GitHub \u65F6\u53EF\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u4EE3\u7406\u524D\u7F00\uFF08\u56FD\u5185\u8BBF\u95EE\u9002\u914D\uFF09", "For nodes hosted on GitHub, set a proxy prefix in Settings (useful in mainland China)"],
  "nodes.installing": ["\u5904\u7406\u4E2D\u2026", "Working\u2026"],
  "nodes.install": ["\u5B89\u88C5", "Install"],
  "nodes.updatingAll": ["\u66F4\u65B0\u4E2D\u2026", "Updating\u2026"],
  "nodes.updateAll": ["\u5168\u90E8\u66F4\u65B0", "Update all"],
  "nodes.logs.title": ["\u64CD\u4F5C\u65E5\u5FD7", "Activity log"],
  "nodes.installedCount": ["\u5DF2\u5B89\u88C5\u8282\u70B9\uFF08{n}\uFF09", "Installed nodes ({n})"],
  "nodes.filterPlaceholder": ["\u8FC7\u6EE4...", "Filter..."],
  "nodes.refresh": ["\u5237\u65B0", "Refresh"],
  "nodes.col.name": ["\u540D\u79F0", "Name"],
  "nodes.col.source": ["\u6765\u6E90", "Source"],
  "nodes.local": ["\u672C\u5730", "Local"],
  "nodes.update": ["\u66F4\u65B0", "Update"],
  "nodes.openDir": ["\u76EE\u5F55", "Folder"],
  "nodes.remove": ["\u5220\u9664", "Remove"],
  "nodes.empty": ["\u6682\u65E0\u5DF2\u5B89\u88C5\u8282\u70B9", "No nodes installed yet"],
  "nodes.done": ["\u5B8C\u6210\uFF1A{name}", "Done: {name}"],
  "nodes.updated": ["{name} \u66F4\u65B0\u5B8C\u6210", "{name} updated"],
  "nodes.updateAllDone": ["\u5168\u90E8\u66F4\u65B0\u5B8C\u6210\uFF1A\u6210\u529F {ok}\uFF0C\u5931\u8D25 {failed}", "Update complete: {ok} succeeded, {failed} failed"],
  "nodes.confirmRemove": ["\u786E\u8BA4\u5220\u9664\u8282\u70B9 {name}\uFF1F\n\u5C06\u5220\u9664\u76EE\u5F55 {path}", "Remove node {name}?\nThis deletes the folder {path}"]
};

// src/shared/i18n/locales/workflows.ts
var workflows_default = {
  "wf.title": ["\u5DE5\u4F5C\u6D41", "Workflows"],
  "wf.pageTitle": ["\u5DE5\u4F5C\u6D41\u7BA1\u7406", "Workflows"],
  "wf.desc": ["\u7BA1\u7406 ComfyUI \u4FDD\u5B58\u7684\u5DE5\u4F5C\u6D41\u6587\u4EF6\uFF0C\u652F\u6301\u5BFC\u5165 JSON \u4E0E\u4E00\u952E\u63D0\u4EA4\u8FD0\u884C\u961F\u5217", "Manage workflow files saved by ComfyUI, with JSON import and one-click queue submission"],
  "wf.dir.title": ["\u5DE5\u4F5C\u6D41\u76EE\u5F55", "Workflow directory"],
  "wf.openDir": ["\u6253\u5F00\u76EE\u5F55", "Open folder"],
  "wf.dir.hint": ["\u5728 ComfyUI \u7F51\u9875\u4E2D\u4FDD\u5B58\u7684\u5DE5\u4F5C\u6D41\u4F1A\u81EA\u52A8\u51FA\u73B0\u5728\u6B64\u76EE\u5F55\uFF1B\u300C\u8FD0\u884C\u300D\u4EC5\u652F\u6301 API \u683C\u5F0F JSON\uFF08\u754C\u9762\u4E2D\u5F00\u542F\u5F00\u53D1\u8005\u6A21\u5F0F\u540E\u5BFC\u51FA\uFF09", 'Workflows saved in the ComfyUI web UI appear here automatically; "Run" only supports API-format JSON (export it in the UI with developer mode enabled)'],
  "wf.libraryCount": ["\u5DE5\u4F5C\u6D41\u5E93\uFF08{n}\uFF09", "Workflow library ({n})"],
  "wf.searchPlaceholder": ["\u641C\u7D22\u540D\u79F0 / \u8DEF\u5F84", "Search name / path"],
  "wf.scanning": ["\u626B\u63CF\u4E2D\u2026", "Scanning\u2026"],
  "wf.refresh": ["\u5237\u65B0", "Refresh"],
  "wf.importJson": ["\u5BFC\u5165 JSON", "Import JSON"],
  "wf.col.name": ["\u540D\u79F0", "Name"],
  "wf.col.format": ["\u683C\u5F0F", "Format"],
  "wf.col.nodeCount": ["\u8282\u70B9\u6570", "Nodes"],
  "wf.col.size": ["\u5927\u5C0F", "Size"],
  "wf.col.date": ["\u65E5\u671F", "Date"],
  "wf.col.relPath": ["\u76F8\u5BF9\u8DEF\u5F84", "Relative path"],
  "wf.format.api": ["API \u683C\u5F0F", "API format"],
  "wf.format.ui": ["\u754C\u9762\u683C\u5F0F", "UI format"],
  "wf.format.unknown": ["\u672A\u77E5", "Unknown"],
  "wf.run.tip.apiOnly": ["\u4EC5 API \u683C\u5F0F\u53EF\u8FD0\u884C", "Only API-format workflows can run"],
  "wf.run.tip.notRunning": ["ComfyUI \u672A\u8FD0\u884C", "ComfyUI is not running"],
  "wf.submitting": ["\u63D0\u4EA4\u4E2D\u2026", "Submitting\u2026"],
  "wf.run": ["\u8FD0\u884C", "Run"],
  "wf.reveal": ["\u5B9A\u4F4D", "Reveal"],
  "wf.remove": ["\u5220\u9664", "Remove"],
  "wf.emptyMatch": ["\u6CA1\u6709\u5339\u914D\u300C{keyword}\u300D\u7684\u5DE5\u4F5C\u6D41", 'No workflows match "{keyword}"'],
  "wf.empty": ["\u6682\u65E0\u5DE5\u4F5C\u6D41\u6587\u4EF6\uFF0C\u53EF\u5728 ComfyUI \u4E2D\u4FDD\u5B58\u6216\u70B9\u51FB\u300C\u5BFC\u5165 JSON\u300D", 'No workflow files yet \u2014 save one in ComfyUI or click "Import JSON"'],
  "wf.toast.imported": ["\u5DF2\u5BFC\u5165 {name}", "Imported {name}"],
  "wf.toast.queued": ["\u5DF2\u63D0\u4EA4\u8FD0\u884C\u961F\u5217\uFF08#{number}\uFF09", "Submitted to the run queue (#{number})"],
  "wf.confirmDelete": ["\u786E\u8BA4\u5220\u9664\u5DE5\u4F5C\u6D41\uFF1F\n{path}", "Delete this workflow?\n{path}"],
  "wf.toast.deleted": ["\u5DF2\u5220\u9664 {name}", "Deleted {name}"]
};

// src/shared/i18n/locales/tools.ts
var tools_default = {
  "tools.title": ["\u8BCA\u65AD", "Diagnostics"],
  "tools.desc": [
    "\u8FD0\u884C\u73AF\u5883\u8BCA\u65AD\u4E0E\u4FEE\u590D\uFF1A\u4F9D\u8D56\u5B8C\u6574\u6027\u3001torch / CUDA\u3001\u865A\u62DF\u73AF\u5883\u6062\u590D",
    "Diagnose and repair the runtime: dependencies, torch / CUDA, virtual environment recovery"
  ],
  "tools.diagTitle": ["\u4E00\u952E\u8BCA\u65AD", "One-click diagnostics"],
  "tools.scanning": ["\u8BCA\u65AD\u4E2D\u2026", "Scanning\u2026"],
  "tools.rescan": ["\u91CD\u65B0\u8BCA\u65AD", "Rescan"],
  "tools.empty": ["\u70B9\u51FB\u300C\u91CD\u65B0\u8BCA\u65AD\u300D\u5F00\u59CB\u68C0\u67E5", 'Click "Rescan" to start'],
  "tools.repairTitle": ["\u4FEE\u590D\u64CD\u4F5C", "Repair actions"],
  "tools.repairPip": ["\u4FEE\u590D pip", "Repair pip"],
  "tools.reinstallTorch": ["\u91CD\u88C5 Torch", "Reinstall Torch"],
  "tools.reinstallDeps": ["\u91CD\u88C5\u4F9D\u8D56", "Reinstall dependencies"],
  "tools.rebuildAll": ["\u91CD\u5EFA\u6574\u4E2A\u73AF\u5883", "Rebuild environment"],
  "tools.repairing": ["\u4FEE\u590D\u8FDB\u884C\u4E2D\uFF0C\u8BF7\u7A0D\u5019\u2026", "Repairing, please wait\u2026"],
  "tools.repairDone": ["\u4FEE\u590D\u5B8C\u6210", "Repair complete"]
};

// src/shared/i18n/locales/settings.ts
var settings_default = {
  "settings.title": ["\u8BBE\u7F6E", "Settings"],
  "settings.appearance.title": ["\u5916\u89C2\u4E0E\u8BED\u8A00", "Appearance & language"],
  "settings.appearance.theme": ["\u4E3B\u9898", "Theme"],
  "settings.appearance.theme.dark": ["\u6DF1\u8272", "Dark"],
  "settings.appearance.theme.light": ["\u4EAE\u8272", "Light"],
  "settings.appearance.locale": ["\u754C\u9762\u8BED\u8A00", "Interface language"],
  "settings.appearance.hint": ["\u5207\u6362\u540E\u7ACB\u5373\u751F\u6548\u5E76\u81EA\u52A8\u4FDD\u5B58", "Applied immediately and saved automatically"],
  "settings.desc": ["\u542F\u52A8\u53C2\u6570\u3001\u4E0B\u8F7D\u6E90\u4E0E\u955C\u50CF\u9002\u914D\u3001\u6A21\u578B\u8DEF\u5F84\u7B49", "Launch arguments, download sources and mirrors, model paths"],
  "settings.autosaveNote": ["\u6539\u52A8\u81EA\u52A8\u4FDD\u5B58\uFF0C\u65E0\u9700\u624B\u52A8\u63D0\u4EA4\uFF1B\u9AD8\u7EA7\u9009\u9879\u5C06\u5728\u4E0B\u6B21\u542F\u52A8 ComfyUI \u65F6\u751F\u6548", "Changes are saved automatically; advanced options take effect the next time ComfyUI starts"],
  /** 启动参数卡片 */
  "settings.launch.title": ["\u542F\u52A8\u53C2\u6570", "Launch arguments"],
  "settings.launch.port": ["\u7AEF\u53E3", "Port"],
  "settings.launch.extraArgs": ["\u989D\u5916\u542F\u52A8\u53C2\u6570", "Extra launch arguments"],
  "settings.launch.extraArgs.ph": ["\u5982 --lowvram --preview-method auto", "e.g. --lowvram --preview-method auto"],
  /** 高级选项 */
  "settings.adv.toggle": ["\u9AD8\u7EA7\u9009\u9879", "Advanced options"],
  "settings.adv.sub": ["\u53C2\u7167\u5B98\u65B9\u6587\u6863\u5206\u7EC4\u914D\u7F6E\u8BE6\u7EC6\u542F\u52A8\u53C2\u6570\uFF0C\u4FDD\u5B58\u540E\u91CD\u542F ComfyUI \u751F\u6548", "Configure detailed launch arguments grouped per the official docs; restart ComfyUI after saving to apply"],
  "settings.adv.preview": ["\u751F\u6210\u53C2\u6570", "Generated arguments"],
  /** 高级选项通用取值标签 */
  "settings.adv.opt.default": ["\u9ED8\u8BA4", "Default"],
  "settings.adv.opt.fp32": ["fp32", "fp32"],
  "settings.adv.opt.fp16": ["fp16", "fp16"],
  "settings.adv.opt.fp64": ["fp64", "fp64"],
  "settings.adv.opt.bf16": ["bf16", "bf16"],
  "settings.adv.opt.fp8e4m3fn": ["fp8 (e4m3fn)", "fp8 (e4m3fn)"],
  "settings.adv.opt.fp8e5m2": ["fp8 (e5m2)", "fp8 (e5m2)"],
  "settings.adv.opt.fp8e8m0fnu": ["fp8 (e8m0fnu)", "fp8 (e8m0fnu)"],
  "settings.adv.tri.on": ["\u542F\u7528", "Enable"],
  "settings.adv.tri.off": ["\u7981\u7528", "Disable"],
  "settings.adv.tri.default.torch": ["\u9ED8\u8BA4\uFF08torch 2.0+ \u81EA\u52A8\uFF09", "Default (automatic on torch 2.0+)"],
  "settings.adv.tri.default.nvidiaOn": ["\u9ED8\u8BA4\uFF08Nvidia \u542F\u7528\uFF09", "Default (enabled on Nvidia)"],
  "settings.adv.tri.default.nvidiaAuto": ["\u9ED8\u8BA4\uFF08Nvidia \u81EA\u52A8\uFF09", "Default (automatic on Nvidia)"],
  /** 高级选项分组标题 */
  "settings.adv.g.network": ["\u7F51\u7EDC\u4E0E\u670D\u52A1\u5668", "Network & server"],
  "settings.adv.g.startup": ["\u542F\u52A8\u4E0E\u6D4F\u89C8\u5668", "Startup & browser"],
  "settings.adv.g.device": ["\u8BBE\u5907\u4E0E CUDA", "Device & CUDA"],
  "settings.adv.g.precision": ["\u7CBE\u5EA6\u4E0E\u63A8\u7406\uFF08\u540C\u7EC4\u4E92\u65A5\uFF09", "Precision & inference (mutually exclusive in group)"],
  "settings.adv.g.preview": ["\u9884\u89C8", "Preview"],
  "settings.adv.g.cache": ["\u7F13\u5B58\uFF08\u4E92\u65A5\uFF09", "Cache (mutually exclusive)"],
  "settings.adv.g.attention": ["\u6CE8\u610F\u529B\u673A\u5236\uFF08\u4E92\u65A5\uFF09", "Attention (mutually exclusive)"],
  "settings.adv.g.vram": ["VRAM \u4E0E\u5185\u5B58", "VRAM & memory"],
  "settings.adv.g.perf": ["\u6027\u80FD\u4E0E\u8C03\u8BD5", "Performance & debugging"],
  "settings.adv.g.manager": ["ComfyUI Manager", "ComfyUI Manager"],
  "settings.adv.g.customNodes": ["\u81EA\u5B9A\u4E49\u8282\u70B9\u4E0E API", "Custom nodes & API"],
  "settings.adv.g.logs": ["\u65E5\u5FD7\u4E0E\u5176\u4ED6", "Logging & misc"],
  /** 网络与服务器 */
  "settings.adv.listen.label": ["\u5141\u8BB8\u5C40\u57DF\u7F51\u8BBF\u95EE\uFF08\u76D1\u542C\u6240\u6709\u63A5\u53E3\uFF09", "Allow LAN access (listen on all interfaces)"],
  "settings.adv.listen.hint": ["\u7B49\u6548 --listen\uFF0C\u5C40\u57DF\u7F51\u5185\u5176\u4ED6\u8BBE\u5907\u53EF\u8BBF\u95EE", "Equivalent to --listen; other devices on the LAN can access it"],
  "settings.adv.enableCors": ["\u542F\u7528 CORS \u8DE8\u57DF", "Enable CORS"],
  "settings.adv.compressResponse": ["HTTP \u54CD\u5E94\u538B\u7F29", "Compress HTTP responses"],
  "settings.adv.maxUploadSize": ["\u6700\u5927\u4E0A\u4F20\u5927\u5C0F (MB)", "Max upload size (MB)"],
  "settings.adv.maxUploadSize.ph": ["\u9ED8\u8BA4 100", "Default 100"],
  /** 启动与浏览器 */
  "settings.adv.autoLaunch": ["\u542F\u52A8\u540E\u6253\u5F00\u6D4F\u89C8\u5668", "Open browser after startup"],
  "settings.adv.autoLaunch.default": ["\u9ED8\u8BA4\uFF08\u81EA\u52A8\u6253\u5F00\uFF09", "Default (auto open)"],
  "settings.adv.autoLaunch.on": ["\u5F3A\u5236\u6253\u5F00\uFF08--auto-launch\uFF09", "Force open (--auto-launch)"],
  "settings.adv.autoLaunch.off": ["\u4E0D\u6253\u5F00\uFF08--disable-auto-launch\uFF09", "Do not open (--disable-auto-launch)"],
  /** 设备与 CUDA */
  "settings.adv.cudaDevice": ["CUDA \u8BBE\u5907 ID", "CUDA device ID"],
  "settings.adv.cudaDevice.ph": ["\u5982 0 \uFF0C\u591A\u5361 0,1 \uFF0Call \u4E3A\u5168\u90E8", "e.g. 0, multi-GPU 0,1, all for every device"],
  "settings.adv.cudaMalloc": ["cudaMallocAsync", "cudaMallocAsync"],
  "settings.adv.directml": ["\u4F7F\u7528 DirectML\uFF08AMD / \u6838\u663E\uFF09", "Use DirectML (AMD / integrated GPU)"],
  /** 精度与推理 */
  "settings.adv.forceFp": ["\u5168\u5C40\u6D6E\u70B9\u7CBE\u5EA6", "Global float precision"],
  "settings.adv.forceFp.fp32": ["\u5F3A\u5236 fp32", "Force fp32"],
  "settings.adv.forceFp.fp16": ["\u5F3A\u5236 fp16", "Force fp16"],
  "settings.adv.forceFp.hint": ["\u5F3A\u5236 fp16 \u4F1A\u540C\u65F6\u8BBE\u7F6E fp16-unet", "Forcing fp16 also sets fp16-unet"],
  "settings.adv.unetPrecision": ["UNET \u7CBE\u5EA6", "UNET precision"],
  "settings.adv.vaePrecision": ["VAE \u7CBE\u5EA6", "VAE precision"],
  "settings.adv.vaePrecision.fp16": ["fp16\uFF08\u53EF\u80FD\u9ED1\u56FE\uFF09", "fp16 (may produce black images)"],
  "settings.adv.vaePrecision.cpu": ["\u5728 CPU \u4E0A\u8FD0\u884C", "Run on CPU"],
  "settings.adv.textEncPrecision": ["\u6587\u672C\u7F16\u7801\u5668\u7CBE\u5EA6", "Text encoder precision"],
  "settings.adv.fp16Intermediates": ["\u4E2D\u95F4\u5F20\u91CF fp16\uFF08\u5B9E\u9A8C\u6027\uFF09", "fp16 intermediate tensors (experimental)"],
  /** 预览 */
  "settings.adv.previewMethod": ["\u91C7\u6837\u9884\u89C8\u65B9\u5F0F", "Sampling preview method"],
  "settings.adv.previewMethod.off": ["\u5173\u95ED\uFF08\u9ED8\u8BA4\uFF09", "Off (default)"],
  "settings.adv.previewMethod.auto": ["auto", "auto"],
  "settings.adv.previewMethod.latent2rgb": ["latent2rgb\uFF08\u5FEB\uFF09", "latent2rgb (fast)"],
  "settings.adv.previewMethod.taesd": ["taesd\uFF08\u6E05\u6670\uFF09", "taesd (sharp)"],
  "settings.adv.previewSize": ["\u9884\u89C8\u5C3A\u5BF8 (px)", "Preview size (px)"],
  "settings.adv.previewSize.ph": ["\u9ED8\u8BA4 512", "Default 512"],
  /** 缓存 */
  "settings.adv.cache": ["\u7F13\u5B58\u6A21\u5F0F", "Cache mode"],
  "settings.adv.cache.ram": ["RAM \u538B\u529B\u7F13\u5B58\uFF08\u9ED8\u8BA4\uFF09", "RAM pressure cache (default)"],
  "settings.adv.cache.none": ["\u7981\u7528\u7F13\u5B58\uFF08\u7701\u5185\u5B58\uFF09", "Disable cache (saves memory)"],
  "settings.adv.cache.classic": ["\u65E7\u7248\u6FC0\u8FDB\u7F13\u5B58", "Legacy aggressive cache"],
  "settings.adv.cache.lru": ["LRU \u7F13\u5B58", "LRU cache"],
  "settings.adv.cacheLruN": ["LRU \u7F13\u5B58\u6761\u6570", "LRU cache entries"],
  "settings.adv.cacheLruN.ph": ["\u9ED8\u8BA4 3", "Default 3"],
  /** 注意力机制 */
  "settings.adv.attention": ["\u4EA4\u53C9\u6CE8\u610F\u529B", "Cross attention"],
  "settings.adv.attention.default": ["\u9ED8\u8BA4\uFF08xformers\uFF09", "Default (xformers)"],
  "settings.adv.attention.split": ["split", "split"],
  "settings.adv.attention.quad": ["quad", "quad"],
  "settings.adv.attention.pytorch": ["pytorch", "pytorch"],
  "settings.adv.attention.sage": ["SageAttention", "SageAttention"],
  "settings.adv.attention.flash": ["FlashAttention", "FlashAttention"],
  "settings.adv.disableXformers": ["\u7981\u7528 xformers", "Disable xformers"],
  "settings.adv.upcastAttention": ["\u6CE8\u610F\u529B\u4E0A\u8F6C\u6362", "Upcast attention"],
  "settings.adv.upcastAttention.on": ["\u5F3A\u5236\u4E0A\u8F6C\u6362\uFF08\u53EF\u4FEE\u9ED1\u56FE\uFF09", "Force upcast (can fix black images)"],
  "settings.adv.upcastAttention.off": ["\u7981\u6B62\u4E0A\u8F6C\u6362\uFF08\u8C03\u8BD5\u7528\uFF09", "Disable upcast (for debugging)"],
  /** VRAM 与内存 */
  "settings.adv.vramMode": ["\u663E\u5B58\u6A21\u5F0F\uFF08\u4E92\u65A5\uFF09", "VRAM mode (mutually exclusive)"],
  "settings.adv.vramMode.auto": ["\u81EA\u52A8", "Automatic"],
  "settings.adv.vramMode.gpuOnly": ["gpu-only\uFF08\u5168\u90E8\u9A7B\u7559 GPU\uFF09", "gpu-only (everything stays on GPU)"],
  "settings.adv.vramMode.highvram": ["highvram\uFF08\u4E0D\u5378\u8F7D\u6A21\u578B\uFF09", "highvram (keep models loaded)"],
  "settings.adv.vramMode.lowvram": ["lowvram\uFF08\u4F4E\u663E\u5B58\uFF09", "lowvram (low VRAM)"],
  "settings.adv.vramMode.novram": ["novram\uFF08\u6781\u4F4E\u663E\u5B58\uFF09", "novram (very low VRAM)"],
  "settings.adv.vramMode.cpu": ["cpu\uFF08\u7EAF CPU\uFF0C\u8F83\u6162\uFF09", "cpu (CPU only, slower)"],
  "settings.adv.reserveVram": ["\u9884\u7559\u663E\u5B58 (GB)", "Reserved VRAM (GB)"],
  "settings.adv.reserveVram.ph": ["\u4E3A\u7CFB\u7EDF\u7B49\u9884\u7559", "Reserve for the system and more"],
  "settings.adv.asyncOffload": ["\u5F02\u6B65\u6743\u91CD\u5378\u8F7D", "Async weight offload"],
  "settings.adv.dynamicVram": ["\u52A8\u6001 VRAM", "Dynamic VRAM"],
  "settings.adv.fastDisk": ["\u4F18\u5148\u9AD8\u901F\u78C1\u76D8\u52A0\u8F7D\uFF08NVMe\uFF09", "Prefer fast disk loading (NVMe)"],
  "settings.adv.disableSmartMemory": ["\u7981\u7528\u667A\u80FD\u5185\u5B58\uFF08\u79EF\u6781\u5378\u8F7D\u5230 RAM\uFF09", "Disable smart memory (aggressively offload to RAM)"],
  "settings.adv.disablePinnedMemory": ["\u7981\u7528\u56FA\u5B9A\u5185\u5B58", "Disable pinned memory"],
  "settings.adv.mmap": ["mmap \u52A0\u8F7D\u6A21\u578B\u6587\u4EF6", "Load model files with mmap"],
  /** 性能与调试 */
  "settings.adv.fast": ["\u542F\u7528\u5168\u90E8 --fast \u5B9E\u9A8C\u4F18\u5316", "Enable all --fast experimental optimizations"],
  "settings.adv.fast.hint": ["\u53EF\u80FD\u5F71\u54CD\u8D28\u91CF\u6216\u7A33\u5B9A\u6027", "May affect quality or stability"],
  "settings.adv.deterministic": ["\u786E\u5B9A\u6027\u7B97\u6CD5\uFF08\u66F4\u6162\uFF09", "Deterministic algorithms (slower)"],
  "settings.adv.hashFunction": ["\u6587\u4EF6\u54C8\u5E0C\u7B97\u6CD5", "File hash algorithm"],
  "settings.adv.hashFunction.sha256": ["sha256\uFF08\u9ED8\u8BA4\uFF09", "sha256 (default)"],
  "settings.adv.hashFunction.md5": ["md5", "md5"],
  "settings.adv.hashFunction.sha1": ["sha1", "sha1"],
  "settings.adv.hashFunction.sha512": ["sha512", "sha512"],
  /** ComfyUI Manager */
  "settings.adv.enableManager": ["\u542F\u7528 ComfyUI-Manager", "Enable ComfyUI-Manager"],
  "settings.adv.disableManagerUi": ["\u4EC5\u7981\u7528 Manager UI", "Disable Manager UI only"],
  "settings.adv.managerLegacyUi": ["\u4F7F\u7528\u65E7\u7248 Manager UI", "Use legacy Manager UI"],
  /** 自定义节点与 API */
  "settings.adv.disableAllCustomNodes": ["\u7981\u7528\u6240\u6709\u81EA\u5B9A\u4E49\u8282\u70B9", "Disable all custom nodes"],
  "settings.adv.disableAllCustomNodes.hint": ["\u6392\u67E5\u8282\u70B9\u51B2\u7A81\u65F6\u4F7F\u7528", "Use when troubleshooting node conflicts"],
  "settings.adv.disableApiNodes": ["\u7981\u7528 API \u8282\u70B9", "Disable API nodes"],
  "settings.adv.disableMetadata": ["\u4E0D\u4FDD\u5B58\u63D0\u793A\u8BCD\u5143\u6570\u636E", "Do not save prompt metadata"],
  "settings.adv.multiUser": ["\u591A\u7528\u6237\u6A21\u5F0F\uFF08\u6309\u7528\u6237\u9694\u79BB\uFF09", "Multi-user mode (isolated per user)"],
  /** 日志与其他 */
  "settings.adv.verbose": ["\u65E5\u5FD7\u7EA7\u522B", "Log level"],
  "settings.adv.verbose.info": ["INFO\uFF08\u9ED8\u8BA4\uFF09", "INFO (default)"],
  "settings.adv.verbose.debug": ["DEBUG", "DEBUG"],
  "settings.adv.verbose.warning": ["WARNING", "WARNING"],
  "settings.adv.verbose.error": ["ERROR", "ERROR"],
  "settings.adv.verbose.critical": ["CRITICAL", "CRITICAL"],
  "settings.adv.logStdout": ["\u65E5\u5FD7\u8F93\u51FA\u5230 stdout", "Log to stdout"],
  "settings.adv.dontPrintServer": ["\u4E0D\u6253\u5370\u670D\u52A1\u5668\u8F93\u51FA", "Do not print server output"],
  /** 源码与镜像卡片 */
  "settings.mirror.title": ["\u6E90\u7801\u4E0E\u955C\u50CF\uFF08\u56FD\u5185\u9002\u914D\uFF09", "Source & mirrors (China-friendly)"],
  "settings.mirror.repo": ["ComfyUI \u6E90\u7801\u4ED3\u5E93", "ComfyUI source repository"],
  "settings.mirror.repo.github": ["GitHub\uFF08\u5B98\u65B9\uFF09", "GitHub (official)"],
  "settings.mirror.repo.gitcode": ["GitCode\uFF08\u56FD\u5185\u955C\u50CF\uFF09", "GitCode (China mirror)"],
  "settings.mirror.repo.custom": ["\u81EA\u5B9A\u4E49\u5730\u5740", "Custom URL"],
  "settings.mirror.customRepo": ["\u81EA\u5B9A\u4E49\u4ED3\u5E93\u5730\u5740", "Custom repository URL"],
  "settings.mirror.gitProxy": ["GitHub \u4EE3\u7406\u524D\u7F00\uFF08\u53EF\u9009\uFF09", "GitHub proxy prefix (optional)"],
  "settings.mirror.gitProxy.ph": ["\u5982 https://ghfast.top/ \u6216\u7559\u7A7A", "e.g. https://ghfast.top/ or leave empty"],
  "settings.mirror.gitProxy.hint": ["\u514B\u9686\u7B2C\u4E09\u65B9\u8282\u70B9\u7B49 GitHub \u5730\u5740\u65F6\u81EA\u52A8\u52A0\u4E0A\u524D\u7F00", "Prefixed automatically when cloning GitHub URLs such as third-party nodes"],
  "settings.mirror.pip": ["pip \u5B89\u88C5\u6E90", "pip index"],
  "settings.mirror.pip.pypi": ["PyPI \u5B98\u65B9\uFF08pypi.org\uFF09", "PyPI official (pypi.org)"],
  "settings.mirror.pip.tuna": ["\u6E05\u534E\u5927\u5B66 TUNA", "Tsinghua TUNA"],
  "settings.mirror.pip.aliyun": ["\u963F\u91CC\u4E91", "Alibaba Cloud"],
  "settings.mirror.pip.ustc": ["\u4E2D\u79D1\u5927 USTC", "USTC"],
  "settings.mirror.torch": ["PyTorch \u4E0B\u8F7D\u6E90\uFF08\u5B89\u88C5 / \u5207\u6362 Torch \u65F6\u4F7F\u7528\uFF09", "PyTorch download source (used when installing or switching Torch)"],
  "settings.mirror.torch.official": ["PyTorch \u5B98\u65B9\uFF08download.pytorch.org\uFF09", "PyTorch official (download.pytorch.org)"],
  "settings.mirror.torch.aliyun": ["\u963F\u91CC\u4E91\u955C\u50CF\uFF08\u56FD\u5185\u63A8\u8350\uFF09", "Alibaba Cloud mirror (recommended in China)"],
  "settings.mirror.torch.hint": ["\u9996\u9009\u6E90\u4E0B\u8F7D\u5931\u8D25\u65F6\u4F1A\u81EA\u52A8\u5207\u6362\u5230\u53E6\u4E00\u6E90\u91CD\u8BD5", "Automatically retries with the other source if the preferred one fails"],
  /** 模型与路径卡片 */
  "settings.paths.title": ["\u6A21\u578B\u4E0E\u8DEF\u5F84", "Models & paths"],
  "settings.paths.modelPath": ["\u6A21\u578B\u4E0B\u8F7D\u8DEF\u5F84\uFF08\u72EC\u7ACB\u76EE\u5F55\uFF0C\u7559\u7A7A\u5219\u4F7F\u7528 ComfyUI \u9ED8\u8BA4 models \u76EE\u5F55\uFF09", "Model download path (separate directory; leave empty to use the ComfyUI default models directory)"],
  "settings.paths.installPath": ["\u5B89\u88C5\u8DEF\u5F84", "Install path"],
  "settings.paths.hfMirror": ["\u6A21\u578B\u4E0B\u8F7D\u9ED8\u8BA4\u542F\u7528 HF \u955C\u50CF\uFF08hf-mirror.com\uFF09", "Use the HF mirror (hf-mirror.com) by default for model downloads"],
  /** 环境卡片 */
  "settings.env.title": ["\u73AF\u5883", "Environment"],
  "settings.env.torchIndex": ["Torch \u6E90\u504F\u597D\uFF08\u5B89\u88C5 / \u5207\u6362 Torch \u65F6\u4F7F\u7528\uFF09", "Torch index preference (used when installing or switching Torch)"],
  "settings.env.torchIndex.auto": ["\u81EA\u52A8\u63A8\u8350", "Auto-recommended"],
  "settings.env.python": ["Python \u89E3\u91CA\u5668\uFF08\u91CD\u5EFA / \u4FEE\u590D\u73AF\u5883\u65F6\u4F7F\u7528\uFF0C\u7559\u7A7A\u81EA\u52A8\u9009\u62E9\uFF09", "Python interpreter (used when rebuilding or repairing the environment; leave empty to auto-select)"]
};

// src/shared/i18n/locales/about.ts
var about_default = {
  "about.title": ["\u5173\u4E8E", "About"],
  "about.desc": [
    "ComfyUI \u4E00\u7AD9\u5F0F\u684C\u9762\u7BA1\u5BB6 \u2014\u2014 \u5B89\u88C5\u3001\u542F\u52A8\u3001\u6A21\u578B / \u8282\u70B9 / \u5DE5\u4F5C\u6D41\u7BA1\u7406",
    "All-in-one ComfyUI desk \u2014 install, launch, and manage models / nodes / workflows"
  ],
  "about.version": ["\u7248\u672C v{version} \xB7 MIT License", "Version v{version} \xB7 MIT License"],
  "about.env.title": ["\u8FD0\u884C\u73AF\u5883", "Runtime"],
  "about.platform": ["\u5E73\u53F0", "Platform"],
  "about.data.title": ["\u6570\u636E\u4F4D\u7F6E", "Data locations"],
  "about.settingsFile": ["\u8BBE\u7F6E\u6587\u4EF6", "Settings file"],
  "about.userData": ["\u7528\u6237\u6570\u636E\u76EE\u5F55", "User data directory"],
  "about.logDir": ["\u65E5\u5FD7\u76EE\u5F55", "Log directory"],
  "about.links.title": ["\u76F8\u5173\u94FE\u63A5", "Links"],
  "about.link.repo": ["ComfyUI \u5B98\u65B9\u4ED3\u5E93", "Official ComfyUI repository"],
  "about.link.docs": ["ComfyUI \u6587\u6863", "ComfyUI documentation"]
};

// src/shared/i18n/locales/main-installer.ts
var main_installer_default = {
  "m.installer.stageSource": ["\u6E90\u7801", "Source"],
  "m.installer.stageTorch": ["Torch", "Torch"],
  "m.installer.stageDeps": ["\u4F9D\u8D56", "Dependencies"],
  "m.installer.stageManager": ["Manager", "Manager"],
  "m.installer.stagePrepare": ["\u51C6\u5907", "Preparing"],
  "m.installer.stagePython": ["Python", "Python"],
  "m.installer.stageUpdate": ["\u66F4\u65B0", "Update"],
  "m.installer.stageDone": ["\u5B8C\u6210", "Done"],
  "m.installer.segIdleTimeout": ["\u4E0B\u8F7D\u6BB5\u7A7A\u95F2\u8D85\u65F6", "Download segment idle timeout"],
  "m.installer.tooManyRedirects": ["\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A", "Too many redirects"],
  "m.installer.httpDownloadFailed": ["\u4E0B\u8F7D\u5931\u8D25 HTTP {code}: {url}", "Download failed HTTP {code}: {url}"],
  "m.installer.repoExistsSwitch": [
    "\u4ED3\u5E93\u5DF2\u5B58\u5728\uFF0C\u5207\u6362\u5230\u76EE\u6807\u7248\u672C...",
    "Repository already exists, switching to the target version..."
  ],
  "m.installer.switchVersionFailed": ["\u5207\u6362\u7248\u672C\u5931\u8D25: {detail}", "Failed to switch version: {detail}"],
  "m.installer.cloneFrom": ["\u4ECE {source} \u514B\u9686 {version} ...", "Cloning {version} from {source} ..."],
  "m.installer.cloneFallback": [
    "git \u514B\u9686\u5931\u8D25\uFF0C\u6539\u7528\u4E0B\u8F7D\u538B\u7F29\u5305...",
    "git clone failed, downloading the archive instead..."
  ],
  "m.installer.downloadingZip": ["\u4E0B\u8F7D ComfyUI \u538B\u7F29\u5305...", "Downloading the ComfyUI archive..."],
  "m.installer.downloadingMb": ["\u4E0B\u8F7D\u4E2D {mb}MB", "Downloading {mb}MB"],
  "m.installer.extracting": ["\u89E3\u538B\u4E2D...", "Extracting..."],
  "m.installer.extractFailed": ["\u89E3\u538B\u5931\u8D25", "Extraction failed"],
  "m.installer.badArchive": ["\u538B\u7F29\u5305\u7ED3\u6784\u5F02\u5E38", "Unexpected archive structure"],
  "m.installer.pkgCached": ["{pkg} \u5DF2\u6709\u7F13\u5B58\uFF0C\u8DF3\u8FC7\u4E0B\u8F7D", "{pkg} is already cached, skipping download"],
  "m.installer.multiThreadDownload": [
    "\u591A\u7EBF\u7A0B\u4E0B\u8F7D {pkg} ...",
    "Downloading {pkg} with multiple connections ..."
  ],
  "m.installer.pkgDownloading": [
    "\u4E0B\u8F7D {pkg}  {done} / {total} MB",
    "Downloading {pkg}  {done} / {total} MB"
  ],
  "m.installer.installTorchToEnv": [
    "\u5B89\u88C5 PyTorch \u5230\u8FD0\u884C\u73AF\u5883...",
    "Installing PyTorch into the runtime environment..."
  ],
  "m.installer.unknownTorchIndex": ["\u672A\u77E5\u7684 torch \u6E90: {index}", "Unknown torch index: {index}"],
  "m.installer.sourceLabelAliyun": ["\u963F\u91CC\u4E91\u955C\u50CF", "Aliyun mirror"],
  "m.installer.sourceLabelOfficial": ["PyTorch \u5B98\u65B9", "PyTorch official"],
  "m.installer.retryWithSource": [
    "\u4E0A\u4E00\u4E2A\u6E90\u8FDE\u63A5\u5931\u8D25\uFF0C\u6539\u7528{label}\u91CD\u8BD5...",
    "The previous source failed, retrying with {label}..."
  ],
  "m.installer.installTorchFrom": [
    "\u5B89\u88C5 PyTorch ({index}, {label}) ...",
    "Installing PyTorch ({index}, {label}) ..."
  ],
  "m.installer.noMatchingWheel": [
    "\u76EE\u5F55\u9875\u89E3\u6790\u4E0D\u5230\u5339\u914D\u7248\u672C\uFF0C\u6539\u7528 pip \u76F4\u63A5\u5B89\u88C5...",
    "No matching version found on the index page, installing directly with pip..."
  ],
  "m.installer.fastDownloadFailed": [
    "\u9AD8\u901F\u4E0B\u8F7D\u5931\u8D25\uFF08{error}\uFF09\uFF0C\u6539\u7528 pip \u91CD\u8BD5...",
    "Fast download failed ({error}), retrying with pip..."
  ],
  "m.installer.torchInstallFailed": [
    "PyTorch \u5B89\u88C5\u5931\u8D25\uFF08\u5DF2\u5C1D\u8BD5\u5B98\u65B9\u6E90\u4E0E\u963F\u91CC\u4E91\u955C\u50CF\uFF09",
    "PyTorch installation failed (tried the official source and the Aliyun mirror)"
  ],
  "m.installer.torchInstallFailedDetail": [
    "PyTorch \u5B89\u88C5\u5931\u8D25\uFF08\u5DF2\u5C1D\u8BD5\u5B98\u65B9\u6E90\u4E0E\u963F\u91CC\u4E91\u955C\u50CF\uFF09\uFF1A{detail}",
    "PyTorch installation failed (tried the official source and the Aliyun mirror): {detail}"
  ],
  "m.installer.installDeps": ["\u5B89\u88C5 ComfyUI \u4F9D\u8D56...", "Installing ComfyUI dependencies..."],
  "m.installer.depsInstallFailed": ["\u4F9D\u8D56\u5B89\u88C5\u5931\u8D25", "Failed to install dependencies"],
  "m.installer.installManagerPip": [
    "\u5B89\u88C5/\u5347\u7EA7 ComfyUI-Manager(\u5B98\u65B9 pip \u5305)...",
    "Installing/upgrading ComfyUI-Manager (official pip package)..."
  ],
  "m.installer.pipManagerFailed": ["pip \u5B89\u88C5 comfyui-manager \u5931\u8D25", "pip install comfyui-manager failed"],
  "m.installer.oldManagerBackedUp": [
    "\u5DF2\u5C06 custom_nodes \u4E0B\u65E7\u7248 Manager \u5907\u4EFD\u4E3A ComfyUI-Manager.bak(\u53EF\u81EA\u884C\u5220\u9664)",
    "The old Manager under custom_nodes was backed up to ComfyUI-Manager.bak (you can delete it yourself)"
  ],
  "m.installer.pipChannelFailed": [
    "pip \u6E20\u9053\u5931\u8D25({error}),\u6539\u7528\u6E90\u7801\u5B89\u88C5...",
    "pip channel failed ({error}), installing from source instead..."
  ],
  "m.installer.managerInstallFailed": [
    "ComfyUI-Manager \u5B89\u88C5\u5931\u8D25(\u4E0D\u5F71\u54CD ComfyUI \u672C\u4F53):{error}",
    "Failed to install ComfyUI-Manager (ComfyUI itself is unaffected): {error}"
  ],
  "m.installer.updateManager": ["\u66F4\u65B0 ComfyUI-Manager ...", "Updating ComfyUI-Manager ..."],
  "m.installer.managerUpdateFailed": ["Manager \u66F4\u65B0\u5931\u8D25", "Failed to update Manager"],
  "m.installer.gitNotFound": ["\u672A\u68C0\u6D4B\u5230 git", "git not found"],
  "m.installer.installManagerSource": ["\u5B89\u88C5 ComfyUI-Manager(\u6E90\u7801) ...", "Installing ComfyUI-Manager (from source) ..."],
  "m.installer.cloneFailed": ["\u514B\u9686\u5931\u8D25: {detail}", "Clone failed: {detail}"],
  "m.installer.installManagerDeps": ["\u5B89\u88C5 Manager \u4F9D\u8D56...", "Installing Manager dependencies..."],
  "m.installer.managerDepsFailed": ["Manager \u4F9D\u8D56\u5B89\u88C5\u5931\u8D25", "Failed to install Manager dependencies"],
  "m.installer.pickInstallPath": ["\u8BF7\u5148\u9009\u62E9\u5B89\u88C5\u8DEF\u5F84", "Please choose an installation path first"],
  "m.installer.checkEnv": ["\u68C0\u67E5\u5B89\u88C5\u73AF\u5883...", "Checking the installation environment..."],
  "m.installer.sourceReady": ["\u6E90\u7801\u5C31\u7EEA", "Source ready"],
  "m.installer.creatingVenv": ["\u521B\u5EFA\u865A\u62DF\u73AF\u5883...", "Creating the virtual environment..."],
  "m.installer.venvReady": ["\u865A\u62DF\u73AF\u5883\u5C31\u7EEA", "Virtual environment ready"],
  "m.installer.torchDone": ["PyTorch \u5B89\u88C5\u5B8C\u6210", "PyTorch installation complete"],
  "m.installer.installDone": ["ComfyUI \u5B89\u88C5\u5B8C\u6210\uFF01", "ComfyUI installation complete!"],
  "m.installer.pullLatest": ["\u62C9\u53D6\u6700\u65B0\u4EE3\u7801...", "Pulling the latest code..."],
  "m.installer.updateFailed": ["\u66F4\u65B0\u5931\u8D25: {detail}", "Update failed: {detail}"],
  "m.installer.updateDeps": ["\u66F4\u65B0\u4F9D\u8D56...", "Updating dependencies..."],
  "m.installer.updateDone": ["\u66F4\u65B0\u5B8C\u6210", "Update complete"]
};

// src/shared/i18n/locales/main-downloads.ts
var main_downloads_default = {
  "m.dl.logResume": [
    "[\u6A21\u578B] \u6062\u590D\u4E2D\u65AD\u7684\u4E0B\u8F7D\uFF1A{filename}\uFF08\u65AD\u70B9\u7EED\u4F20\uFF09",
    "[Model] Resuming interrupted download: {filename} (breakpoint resume)"
  ],
  "m.dl.logDone": ["[\u6A21\u578B] \u4E0B\u8F7D\u5B8C\u6210\uFF1A{path}", "[Model] Download complete: {path}"],
  "m.dl.logFailed": ["[\u6A21\u578B] \u4E0B\u8F7D\u5931\u8D25 {filename}\uFF1A{error}", "[Model] Download failed {filename}: {error}"],
  "m.dl.logStart": ["[\u6A21\u578B] \u5F00\u59CB\u4E0B\u8F7D {filename} \u2192 {category}", "[Model] Start download {filename} \u2192 {category}"],
  "m.dl.logStartMirror": [
    "[\u6A21\u578B] \u5F00\u59CB\u4E0B\u8F7D {filename} \u2192 {category}\uFF08HF \u955C\u50CF\uFF09",
    "[Model] Start download {filename} \u2192 {category} (HF mirror)"
  ],
  "m.dl.logPaused": ["[\u6A21\u578B] \u5DF2\u6682\u505C {filename}", "[Model] Paused {filename}"],
  "m.dl.logResumed": ["[\u6A21\u578B] \u7EE7\u7EED\u4E0B\u8F7D {filename}", "[Model] Resuming download {filename}"],
  "m.dl.logCleared": ["[\u6A21\u578B] \u5DF2\u6E05\u9664\u8BB0\u5F55 {filename}", "[Model] Record cleared {filename}"],
  "m.dl.logCanceled": ["[\u6A21\u578B] \u5DF2\u53D6\u6D88\u4E0B\u8F7D {filename}", "[Model] Download canceled {filename}"],
  "m.dl.errTooManyRedirects": ["\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A", "Too many redirects"],
  "m.dl.errNotModelFile": [
    "\u670D\u52A1\u5668\u8FD4\u56DE\u7F51\u9875\u800C\u975E\u6A21\u578B\u6587\u4EF6\uFF08\u53EF\u80FD\u662F\u9875\u9762\u94FE\u63A5\u6216\u9700\u767B\u5F55\u624D\u53EF\u4E0B\u8F7D\uFF09",
    "The server returned a web page instead of a model file (the link may be a page link or require sign-in to download)"
  ]
};

// src/shared/i18n/locales/main-process.ts
var main_process_default = {
  "m.proc.autoVram": [
    "[\u8BBE\u7F6E] \u68C0\u6D4B\u5230\u663E\u5B58 {vram} GB\uFF0C\u5DF2\u81EA\u52A8\u542F\u7528 --{mode}\uFF08\u4EC5\u9996\u6B21\u81EA\u52A8\u8BBE\u7F6E\uFF0C\u53EF\u5728\u300C\u8BBE\u7F6E\u300D\u9875\u8C03\u6574\uFF09",
    '[Settings] Detected {vram} GB VRAM; enabled --{mode} automatically (first launch only, adjust it on the "Settings" page)'
  ],
  "m.proc.alreadyRunning": ["ComfyUI \u5DF2\u5728\u8FD0\u884C\u4E2D", "ComfyUI is already running"],
  "m.proc.notInstalled": [
    "\u5C1A\u672A\u5B89\u88C5 ComfyUI\uFF0C\u8BF7\u5148\u5230\u300C\u5B89\u88C5\u300D\u9875\u5B8C\u6210\u5B89\u88C5",
    'ComfyUI is not installed yet. Please complete the installation on the "Install" page'
  ],
  "m.proc.venvMissing": [
    "\u8FD0\u884C\u73AF\u5883\u7F3A\u5931\uFF0C\u8BF7\u5230\u300C\u8BCA\u65AD\u300D\u9875\u6267\u884C\u73AF\u5883\u4FEE\u590D",
    'Runtime environment is missing. Please repair it on the "Diagnostics" page'
  ],
  "m.proc.starting": ["[\u542F\u52A8] {cmd}", "[Start] {cmd}"],
  "m.proc.portInUse": [
    "[\u542F\u52A8\u5931\u8D25] \u7AEF\u53E3 {port} \u5DF2\u88AB\u5360\u7528\uFF0C\u53EF\u80FD\u662F\u6B8B\u7559\u7684 ComfyUI \u8FDB\u7A0B\u6216\u5176\u4ED6\u7A0B\u5E8F",
    "[Start failed] Port {port} is already in use, possibly by a leftover ComfyUI process or another program"
  ],
  "m.proc.portInUseHint": [
    "[\u63D0\u793A] \u53EF\u5728\u300C\u8BBE\u7F6E\u300D\u9875\u66F4\u6362\u7AEF\u53E3\uFF1B\u6392\u67E5\u5360\u7528\u53EF\u5728\u7EC8\u7AEF\u6267\u884C netstat -ano | findstr :{port}",
    '[Tip] Change the port on the "Settings" page; to find the process using it, run netstat -ano | findstr :{port} in a terminal'
  ],
  "m.proc.error": ["[\u9519\u8BEF] {msg}", "[Error] {msg}"],
  "m.proc.exited": ["[\u9000\u51FA] \u8FDB\u7A0B\u7ED3\u675F\uFF0C\u9000\u51FA\u7801 {code}", "[Exit] Process ended with exit code {code}"],
  "m.proc.stopping": ["[\u505C\u6B62] \u6B63\u5728\u5173\u95ED ComfyUI ...", "[Stop] Shutting down ComfyUI ..."]
};

// src/shared/i18n/locales/main-ipc.ts
var main_ipc_default = {
  "m.ipc.streamLine": ["[{tag}] {text}", "[{tag}] {text}"],
  "m.ipc.tag.install": ["\u5B89\u88C5", "Install"],
  "m.ipc.tag.update": ["\u66F4\u65B0", "Update"],
  "m.ipc.tag.torch": ["Torch", "Torch"],
  "m.ipc.tag.nodes": ["\u8282\u70B9", "Nodes"],
  "m.ipc.tag.repair": ["\u4FEE\u590D", "Repair"],
  "m.ipc.log.ui": ["[\u754C\u9762] {message}", "[UI] {message}"],
  "m.ipc.log.installStart": [
    "[\u5B89\u88C5] \u5F00\u59CB\u5B89\u88C5 ComfyUI {version}\uFF08torch \u6E90\uFF1A{index}\uFF09",
    "[Install] Installing ComfyUI {version} (torch index: {index})"
  ],
  "m.ipc.log.installFailed": ["[\u5B89\u88C5] \u5B89\u88C5\u5931\u8D25\uFF1A{error}", "[Install] Install failed: {error}"],
  "m.ipc.log.updateStart": ["[\u66F4\u65B0] \u5F00\u59CB\u66F4\u65B0 ComfyUI \u2192 {version}", "[Update] Updating ComfyUI \u2192 {version}"],
  "m.ipc.log.updateFailed": ["[\u66F4\u65B0] \u66F4\u65B0\u5931\u8D25\uFF1A{error}", "[Update] Update failed: {error}"],
  "m.ipc.log.torchSwitchStart": ["[Torch] \u5F00\u59CB\u5207\u6362 torch \u6E90\uFF1A{index}", "[Torch] Switching torch index: {index}"],
  "m.ipc.log.torchSwitchFailed": ["[Torch] \u5207\u6362\u5931\u8D25\uFF1A{error}", "[Torch] Switch failed: {error}"],
  "m.ipc.stage.done": ["\u5B8C\u6210", "Done"],
  "m.ipc.torchSwitched": ["Torch \u5207\u6362\u5B8C\u6210", "Torch switched"],
  "m.ipc.log.modelDeleted": ["[\u6A21\u578B] \u5DF2\u5220\u9664 {path}", "[Models] Deleted {path}"],
  "m.ipc.log.modelDownloadTaken": [
    "[\u6A21\u578B] \u63A5\u7BA1\u754C\u9762\u5185\u4E0B\u8F7D\uFF1A{name} url={url}",
    "[Models] Intercepted in-app download: {name} url={url}"
  ],
  "m.ipc.log.nodeInstallFailed": ["[\u8282\u70B9] \u5B89\u88C5\u5931\u8D25\uFF1A{error}", "[Nodes] Install failed: {error}"],
  "m.ipc.log.nodeUpdateFailed": ["[\u8282\u70B9] {name} \u66F4\u65B0\u5931\u8D25\uFF1A{error}", "[Nodes] Failed to update {name}: {error}"],
  "m.ipc.log.nodeDeleted": ["[\u8282\u70B9] \u5DF2\u5220\u9664 {name}", "[Nodes] Deleted {name}"],
  "m.ipc.log.workflowQueued": [
    "[\u5DE5\u4F5C\u6D41] \u63D0\u4EA4\u8FD0\u884C {path}\uFF08\u961F\u5217 #{number}\uFF09",
    "[Workflows] Queued run {path} (queue #{number})"
  ],
  "m.ipc.log.workflowDeleted": ["[\u5DE5\u4F5C\u6D41] \u5DF2\u5220\u9664 {path}", "[Workflows] Deleted {path}"],
  "m.ipc.log.repairStart": ["[\u4FEE\u590D] \u5F00\u59CB\u73AF\u5883\u4FEE\u590D\uFF08{mode}\uFF09", "[Repair] Repairing environment ({mode})"],
  "m.ipc.log.repairFailed": ["[\u4FEE\u590D] \u4FEE\u590D\u5931\u8D25\uFF1A{error}", "[Repair] Repair failed: {error}"],
  "m.ipc.err.invalidComfyDir": [
    "\u6240\u9009\u76EE\u5F55\u4E0D\u662F\u6709\u6548\u7684 ComfyUI \u5B89\u88C5\uFF08\u672A\u627E\u5230 main.py\uFF09",
    "The selected directory is not a valid ComfyUI installation (main.py not found)"
  ]
};

// src/shared/i18n/locales/main-diagnostics.ts
var main_diagnostics_default = {
  "m.diag.src.name": ["ComfyUI \u6E90\u7801", "ComfyUI source"],
  "m.diag.src.missing": [
    "\u672A\u627E\u5230 main.py\uFF0C\u8BF7\u5148\u5728\u300C\u5B89\u88C5\u300D\u9875\u5B89\u88C5",
    'main.py not found. Please install on the "Install" page first'
  ],
  "m.diag.venv.name": ["Python \u865A\u62DF\u73AF\u5883", "Python virtual environment"],
  "m.diag.venv.missing": ["\u672A\u521B\u5EFA\u865A\u62DF\u73AF\u5883", "Virtual environment not created"],
  "m.diag.pip.name": ["pip", "pip"],
  "m.diag.pip.unavailable": ["pip \u4E0D\u53EF\u7528\uFF0C\u53EF\u6267\u884C\u4FEE\u590D", "pip unavailable; run repair"],
  "m.diag.torch.name": ["PyTorch", "PyTorch"],
  "m.diag.torch.passCuda": ["torch {ver} / CUDA \u53EF\u7528", "torch {ver} / CUDA available"],
  "m.diag.torch.passNoCuda": ["torch {ver} / CUDA \u4E0D\u53EF\u7528", "torch {ver} / CUDA unavailable"],
  "m.diag.torch.missing": ["\u672A\u5B89\u88C5\u6216\u65E0\u6CD5\u5BFC\u5165 torch", "torch not installed or cannot be imported"],
  "m.diag.cuda.name": ["CUDA \u52A0\u901F", "CUDA acceleration"],
  "m.diag.cuda.warn": ["CUDA \u4E0D\u53EF\u7528\uFF0C\u5C06\u4EE5 CPU \u6A21\u5F0F\u8FD0\u884C\uFF08\u901F\u5EA6\u6162\uFF09", "CUDA unavailable; will run in CPU mode (slow)"],
  "m.diag.deps.name": ["\u4F9D\u8D56\u5B8C\u6574\u6027", "Dependency integrity"],
  "m.diag.deps.ok": ["\u65E0\u51B2\u7A81", "No conflicts"],
  "m.diag.deps.conflict": ["\u5B58\u5728\u4F9D\u8D56\u51B2\u7A81", "Dependency conflicts found"],
  "m.diag.git.name": ["Git", "Git"],
  "m.diag.git.unavailable": ["git \u4E0D\u53EF\u7528\uFF0C\u5B89\u88C5/\u66F4\u65B0\u8282\u70B9\u529F\u80FD\u5C06\u53D7\u9650", "git unavailable; node install/update will be limited"],
  "m.diag.stage.repair": ["\u4FEE\u590D", "Repair"],
  "m.diag.stage.done": ["\u5B8C\u6210", "Done"],
  "m.diag.repair.removeVenv": ["\u5220\u9664\u65E7\u865A\u62DF\u73AF\u5883...", "Removing old virtual environment..."],
  "m.diag.repair.rebuildVenv": ["\u91CD\u5EFA\u865A\u62DF\u73AF\u5883...", "Rebuilding virtual environment..."],
  "m.diag.repair.rebuilt": ["\u73AF\u5883\u91CD\u5EFA\u5B8C\u6210", "Environment rebuild complete"],
  "m.diag.repair.needPython": [
    "\u91CD\u5EFA\u73AF\u5883\u9700\u8981\u63D0\u4F9B Python \u8DEF\u5F84\uFF08\u5B89\u88C5\u9875\u9009\u62E9\uFF09",
    "A Python path is required to rebuild the environment (select one on the Install page)"
  ],
  "m.diag.repair.pipStart": ["\u4FEE\u590D pip ...", "Repairing pip ..."],
  "m.diag.repair.pipFailed": ["pip \u4FEE\u590D\u5931\u8D25", "pip repair failed"],
  "m.diag.repair.pipDone": ["pip \u5DF2\u4FEE\u590D", "pip repaired"],
  "m.diag.repair.torchDone": ["PyTorch \u91CD\u88C5\u5B8C\u6210", "PyTorch reinstall complete"],
  "m.diag.repair.depsDone": ["\u4F9D\u8D56\u4FEE\u590D\u5B8C\u6210", "Dependencies repaired"]
};

// src/shared/i18n/locales/main-nodes.ts
var main_nodes_default = {
  "m.nodes.installDepsStart": ["\u5B89\u88C5\u8282\u70B9\u4F9D\u8D56 requirements.txt ...", "Installing node dependencies from requirements.txt ..."],
  "m.nodes.depsWarn": [
    "[\u8B66\u544A] \u4F9D\u8D56\u5B89\u88C5\u672A\u5B8C\u5168\u6210\u529F\uFF0C\u53EF\u7A0D\u540E\u91CD\u8BD5",
    "[Warning] Dependency installation did not fully succeed; you can retry later"
  ],
  "m.nodes.runInstallPy": ["\u6267\u884C install.py ...", "Running install.py ..."],
  "m.nodes.invalidUrl": ["\u8BF7\u8F93\u5165\u6709\u6548\u7684 git \u4ED3\u5E93\u5730\u5740", "Please enter a valid git repository URL"],
  "m.nodes.exists": ["\u8282\u70B9 {name} \u5DF2\u5B58\u5728", "Node {name} already exists"],
  "m.nodes.cloning": ["\u514B\u9686 {url} ...", "Cloning {url} ..."],
  "m.nodes.cloneFailed": ["\u514B\u9686\u5931\u8D25: {msg}", "Clone failed: {msg}"],
  "m.nodes.installDone": ["\u8282\u70B9\u5B89\u88C5\u5B8C\u6210: {name}", "Node installed: {name}"],
  "m.nodes.notFound": ["\u8282\u70B9\u4E0D\u5B58\u5728: {name}", "Node not found: {name}"],
  "m.nodes.notGitRepo": ["\u8BE5\u8282\u70B9\u4E0D\u662F git \u4ED3\u5E93\uFF0C\u65E0\u6CD5\u66F4\u65B0", "This node is not a git repository and cannot be updated"],
  "m.nodes.updating": ["\u66F4\u65B0 {name} ...", "Updating {name} ..."],
  "m.nodes.updateFailed": ["\u66F4\u65B0\u5931\u8D25: {msg}", "Update failed: {msg}"],
  "m.nodes.updateDone": ["{name} \u66F4\u65B0\u5B8C\u6210", "{name} updated"],
  "m.nodes.itemFailed": ["[\u5931\u8D25] {name}: {msg}", "[Failed] {name}: {msg}"],
  "m.nodes.updateAllDone": [
    "\u5168\u90E8\u66F4\u65B0\u5B8C\u6210\uFF1A\u6210\u529F {ok}\uFF0C\u5931\u8D25 {failed}",
    "All updates finished: {ok} succeeded, {failed} failed"
  ],
  "m.nodes.invalidPath": ["\u975E\u6CD5\u8DEF\u5F84", "Invalid path"],
  "m.wf.invalidPath": ["\u975E\u6CD5\u8DEF\u5F84", "Invalid path"],
  "m.wf.dialogFilter": ["ComfyUI \u5DE5\u4F5C\u6D41", "ComfyUI Workflow"],
  "m.wf.notRunning": ["ComfyUI \u672A\u8FD0\u884C\uFF0C\u8BF7\u5148\u542F\u52A8\u670D\u52A1", "ComfyUI is not running. Please start the service first"],
  "m.wf.notJson": ["\u5DE5\u4F5C\u6D41\u6587\u4EF6\u4E0D\u662F\u5408\u6CD5 JSON", "The workflow file is not valid JSON"],
  "m.wf.uiFormat": [
    "\u8BE5\u6587\u4EF6\u662F\u754C\u9762\u683C\u5F0F\u5DE5\u4F5C\u6D41\uFF0C\u65E0\u6CD5\u76F4\u63A5\u8FD0\u884C\uFF1B\u8BF7\u5728 ComfyUI \u4E2D\u5F00\u542F\u5F00\u53D1\u8005\u6A21\u5F0F\u5E76\u5BFC\u51FA\u300CAPI \u683C\u5F0F\u300DJSON",
    'This file is a UI-format workflow and cannot be run directly. Enable developer mode in ComfyUI and export it as an "API format" JSON'
  ],
  "m.wf.unknownFormat": ["\u65E0\u6CD5\u8BC6\u522B\u7684\u5DE5\u4F5C\u6D41\u683C\u5F0F", "Unrecognized workflow format"],
  "m.wf.submitFailed": ["\u63D0\u4EA4\u5931\u8D25 HTTP {status}\uFF1A{detail}", "Submission failed (HTTP {status}): {detail}"],
  "m.models.invalidPath": ["\u975E\u6CD5\u8DEF\u5F84", "Invalid path"]
};

// src/shared/i18n/locales/main-terminal.ts
var main_terminal_default = {
  "m.py.tagUnrecognized": ["\u65E0\u6CD5\u8BC6\u522B Python \u7248\u672C\u6807\u7B7E: {detail}", "Unrecognized Python version tag: {detail}"],
  "m.py.versionUnknown": ["\u672A\u77E5", "Unknown"],
  "m.py.venvFailed": ["\u521B\u5EFA\u865A\u62DF\u73AF\u5883\u5931\u8D25: {detail}", "Failed to create virtual environment: {detail}"],
  "m.gpu.unknownName": ["\u672A\u77E5\u663E\u5361", "Unknown GPU"]
};

// src/shared/i18n/locales/main-misc.ts
var main_misc_default = {
  /** webview 弹窗防火墙：模型链接转交下载 */
  "m.misc.guard.popupTaken": ["[\u6A21\u578B] \u63A5\u7BA1\u5F39\u7A97\u4E0B\u8F7D\uFF1A{url}", "[Model] Taking over popup download: {url}"],
  /** webview 导航防火墙：模型链接本页跳转 */
  "m.misc.guard.navDownloadBlocked": [
    "[\u6A21\u578B] \u62E6\u622A\u754C\u9762\u672C\u9875\u4E0B\u8F7D\u8DF3\u8F6C\uFF1A{url}",
    "[Model] Blocked in-page download navigation: {url}"
  ]
};

// src/shared/i18n/index.ts
var MESSAGES = {
  ...common_default,
  ...app_default,
  ...nav_default,
  ...store_default,
  ...dashboard_default,
  ...workbench_default,
  ...install_default,
  ...logs_default,
  ...terminal_default,
  ...models_default,
  ...nodes_default,
  ...workflows_default,
  ...tools_default,
  ...settings_default,
  ...about_default,
  ...main_installer_default,
  ...main_downloads_default,
  ...main_process_default,
  ...main_ipc_default,
  ...main_diagnostics_default,
  ...main_nodes_default,
  ...main_terminal_default,
  ...main_misc_default
};
function translate(locale, key, params) {
  const pair = MESSAGES[key];
  if (!pair) return String(key);
  let s = locale === "en" ? pair[1] : pair[0];
  if (params) {
    for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  }
  return s;
}

// src/main/i18n.ts
var cur = "zh";
function t(key, params) {
  return translate(cur, key, params);
}

// src/main/gpu.ts
function vendorOf(name) {
  const n = name.toLowerCase();
  if (n.includes("nvidia") || n.includes("geforce") || n.includes("rtx") || n.includes("gtx")) return "nvidia";
  if (n.includes("amd") || n.includes("radeon")) return "amd";
  if (n.includes("intel")) return "intel";
  return "unknown";
}
async function nvidiaVram() {
  try {
    const r = await run("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], { timeoutMs: 8e3 });
    if (r.code === 0) return r.out.split(/\r?\n/).map((l) => parseInt(l.trim(), 10) || 0).filter((n) => n > 0);
  } catch {
  }
  return [];
}
async function detectGpu() {
  const ps = "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress";
  try {
    const r = await run("powershell", ["-NoProfile", "-Command", ps], { timeoutMs: 15e3 });
    if (r.code === 0 && r.out.trim()) {
      const data = JSON.parse(r.out.trim());
      const arr = Array.isArray(data) ? data : [data];
      const gpus = arr.map((x) => ({
        name: x.Name || t("m.gpu.unknownName"),
        driver: x.DriverVersion || "",
        vendor: vendorOf(x.Name || ""),
        vram: 0
      }));
      if (gpus.some((g) => g.vendor === "nvidia")) {
        const vrams = await nvidiaVram();
        let i = 0;
        for (const g of gpus) {
          if (g.vendor === "nvidia" && i < vrams.length) g.vram = vrams[i++];
        }
      }
      return gpus;
    }
  } catch {
  }
  return [];
}

// src/main/logger.ts
var import_electron2 = require("electron");
var import_node_fs2 = __toESM(require("node:fs"));
var import_node_path2 = __toESM(require("node:path"));
var KEEP_DAYS = 7;
var dir = "";
var cleaned = false;
function logDir() {
  if (!dir) dir = import_node_path2.default.join(import_electron2.app.getPath("userData"), "logs");
  return dir;
}
function todayFile() {
  const d = /* @__PURE__ */ new Date();
  const p = (n) => String(n).padStart(2, "0");
  return import_node_path2.default.join(logDir(), `launcher-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.log`);
}
function cleanOld() {
  if (cleaned) return;
  cleaned = true;
  try {
    const files = import_node_fs2.default.readdirSync(logDir()).filter((f) => /^launcher-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) {
      import_node_fs2.default.rmSync(import_node_path2.default.join(logDir(), f), { force: true });
    }
  } catch {
  }
}
function appendLog(l) {
  try {
    import_node_fs2.default.mkdirSync(logDir(), { recursive: true });
    cleanOld();
    const t2 = new Date(l.ts).toTimeString().slice(0, 8);
    import_node_fs2.default.appendFileSync(todayFile(), `${t2} [${l.stream}] ${l.text}
`, "utf-8");
  } catch {
  }
}

// src/main/process.ts
var MAX_LOG = 5e3;
function normalizeStream(stream, line) {
  if (stream !== "stderr") return stream;
  if (/\[(INFO|DEBUG)\]/i.test(line)) return "stdout";
  if (/^\s*\d+%\|/.test(line)) return "stdout";
  return stream;
}
var ComfyProcess = class extends import_node_events.EventEmitter {
  child = null;
  status = "stopped";
  logs = [];
  pushLog(stream, text) {
    const line = { ts: Date.now(), stream, text };
    this.logs.push(line);
    if (this.logs.length > MAX_LOG) this.logs.splice(0, this.logs.length - MAX_LOG);
    this.emit("log", line);
    appendLog(line);
  }
  setStatus(s) {
    this.status = s;
    this.emit("status", s);
  }
  /** 探测端口是否已被占用（连接成功即被占用） */
  portInUse(port) {
    return new Promise((resolve) => {
      const sock = import_node_net.default.createConnection({ host: "127.0.0.1", port });
      const done = (inUse) => {
        sock.destroy();
        resolve(inUse);
      };
      sock.once("connect", () => done(true));
      sock.once("error", () => done(false));
      sock.setTimeout(1500, () => done(false));
    });
  }
  /** 首次启动时按最大显存自动选择 VRAM 模式并写入设置，仅执行一次 */
  async applyAutoVramOnce() {
    const s = loadSettings();
    if (s.vramModeAutoApplied) return;
    saveSettings({ vramModeAutoApplied: true });
    try {
      const gpus = await detectGpu();
      const vram = Math.max(0, ...gpus.filter((g) => g.vendor === "nvidia").map((g) => g.vram));
      if (!vram) return;
      const mode = vram < 4096 ? "novram" : vram < 8192 ? "lowvram" : "";
      if (!mode) return;
      const cur2 = loadSettings();
      const tokens = cur2.launchArgs.split(/\s+/).filter(Boolean);
      if (!tokens.includes(`--${mode}`)) {
        saveSettings({ launchArgs: [...tokens, `--${mode}`].join(" ") });
        this.pushLog("sys", t("m.proc.autoVram", { vram: (vram / 1024).toFixed(1), mode }));
      }
    } catch {
    }
  }
  async start() {
    if (this.child) throw new Error(t("m.proc.alreadyRunning"));
    if (!isInstalled()) throw new Error(t("m.proc.notInstalled"));
    const s = loadSettings();
    const p = paths();
    if (!import_node_fs3.default.existsSync(p.venvPython)) throw new Error(t("m.proc.venvMissing"));
    const args = ["-s", "main.py", "--port", String(s.port), "--windows-standalone-build"];
    if (s.modelPath) args.push("--extra-model-paths-config", "extra_model_paths.yaml");
    await this.applyAutoVramOnce();
    const cur2 = loadSettings();
    const userArgs = splitArgs(cur2.launchArgs);
    this.writeExtraModelPaths();
    this.setStatus("starting");
    this.pushLog("sys", t("m.proc.starting", { cmd: `${p.venvPython} ${args.concat(userArgs).join(" ")}` }));
    if (await this.portInUse(s.port)) {
      this.pushLog("sys", t("m.proc.portInUse", { port: s.port }));
      this.pushLog("sys", t("m.proc.portInUseHint", { port: s.port }));
      this.setStatus("error");
      return;
    }
    const pipIndex = PIP_MIRRORS[s.pipMirror];
    const child = (0, import_node_child_process2.spawn)(p.venvPython, args.concat(userArgs), {
      cwd: p.comfy,
      windowsHide: true,
      // hfMirror：ComfyUI / Manager 运行时的 HuggingFace 下载也走 hf-mirror.com
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
        ...s.hfMirror ? { HF_ENDPOINT: "https://hf-mirror.com" } : {},
        ...pipIndex ? { PIP_INDEX_URL: pipIndex } : {}
      }
    });
    this.child = child;
    const onData = (stream) => (d) => {
      const text = d.toString("utf-8");
      for (const ln of text.split(/\r?\n/)) {
        if (!ln) continue;
        this.pushLog(normalizeStream(stream, ln), ln);
        if (/To see the GUI go to:/i.test(ln)) this.setStatus("running");
      }
    };
    child.stdout?.on("data", onData("stdout"));
    child.stderr?.on("data", onData("stderr"));
    child.on("error", (e) => {
      this.pushLog("sys", t("m.proc.error", { msg: e.message }));
      this.setStatus("error");
      this.child = null;
    });
    child.on("close", (code) => {
      this.pushLog("sys", t("m.proc.exited", { code: String(code) }));
      if (this.status !== "error" && this.status !== "stopped") this.setStatus(code === 0 ? "stopped" : "error");
      this.child = null;
    });
  }
  /** 当用户设置独立模型目录时，生成 extra_model_paths.yaml 供 ComfyUI 读取 */
  writeExtraModelPaths() {
    const s = loadSettings();
    if (!s.modelPath) return;
    const p = paths();
    let yaml = "launcher:\n  base_path: " + s.modelPath.replace(/\\/g, "/") + "\n";
    for (const dir2 of ["checkpoints", "clip", "clip_vision", "configs", "controlnet", "diffusion_models", "embeddings", "loras", "style_models", "text_encoders", "unet", "upscale_models", "vae", "vae_approx"]) {
      yaml += `  ${dir2}: ${dir2}
`;
    }
    try {
      import_node_fs3.default.writeFileSync(import_node_path3.default.join(p.comfy, "extra_model_paths.yaml"), yaml, "utf-8");
    } catch {
    }
  }
  async stop() {
    if (!this.child) return;
    this.pushLog("sys", t("m.proc.stopping"));
    killTree(this.child.pid);
    this.child = null;
    this.setStatus("stopped");
  }
  async restart() {
    await this.stop();
    await new Promise((r) => setTimeout(r, 800));
    await this.start();
  }
  async dispose() {
    await this.stop();
  }
};
var comfy = new ComfyProcess();

// src/main/models.ts
var CATEGORIES = [
  "checkpoints",
  "clip",
  "clip_vision",
  "configs",
  "controlnet",
  "diffusion_models",
  "embeddings",
  "loras",
  "style_models",
  "text_encoders",
  "unet",
  "upscale_models",
  "vae",
  "vae_approx"
];
function modelCategories() {
  return CATEGORIES;
}

// src/main/downloads.ts
var MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)$/i;
var MODEL_URL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)(\?[^\s?]*)?(#[^\s]*)?$/i;
function isModelUrl(u) {
  return /^https?:\/\//i.test(u) && MODEL_URL_EXT.test(u);
}
function modelBaseName(url) {
  return guessName(url) || "model.bin";
}
var states = /* @__PURE__ */ new Map();
var broadcast = () => {
};
var throttle = null;
function initDownloads(fn) {
  broadcast = fn;
  restore();
}
function snapshot() {
  return [...states.values()].map((s) => ({ ...s.task })).sort((a, b) => b.startedAt - a.startedAt);
}
function listDownloads() {
  return snapshot();
}
function emitSoon() {
  if (!throttle) throttle = setTimeout(() => {
    throttle = null;
    broadcast(snapshot());
  }, 300);
}
function emitNow() {
  if (throttle) {
    clearTimeout(throttle);
    throttle = null;
  }
  broadcast(snapshot());
  persist();
}
var storePath = "";
function storeFile() {
  if (!storePath) storePath = import_node_path4.default.join(import_electron3.app.getPath("userData"), "downloads.json");
  return storePath;
}
function persist() {
  try {
    const list = snapshot().filter((t2) => t2.status !== "completed");
    import_node_fs4.default.writeFileSync(storeFile(), JSON.stringify(list), "utf-8");
  } catch {
  }
}
function restore() {
  let list = [];
  try {
    if (!import_node_fs4.default.existsSync(storeFile())) return;
    const raw = JSON.parse(import_node_fs4.default.readFileSync(storeFile(), "utf-8"));
    if (Array.isArray(raw)) list = raw;
  } catch {
    return;
  }
  let resumed = 0;
  for (const t2 of list) {
    if (!t2 || typeof t2.url !== "string" || typeof t2.dest !== "string" || !t2.filename || !t2.category) continue;
    if (states.has(t2.dest)) continue;
    if (import_node_fs4.default.existsSync(t2.dest)) continue;
    const st = {
      task: { ...t2, id: t2.id || import_node_crypto.default.randomUUID(), speed: 0 },
      lastBytes: 0,
      lastBytesAt: Date.now(),
      halt: "none"
    };
    const tmp = t2.dest + ".downloading";
    try {
      if (import_node_fs4.default.existsSync(tmp)) st.task.received = import_node_fs4.default.statSync(tmp).size;
    } catch {
    }
    states.set(t2.dest, st);
    if (t2.status === "downloading") {
      resumed++;
      comfy.pushLog("sys", t("m.dl.logResume", { filename: t2.filename }));
      void runTask(st);
    } else if (t2.status !== "paused") {
      st.task.status = "error";
    }
  }
  if (states.size) emitNow();
}
function normalizeUrl(input, useHfMirror = false) {
  let u = input.trim();
  u = u.replace(/^(https?:\/\/)(?:huggingface\.co|hf-mirror\.com)(\/[^/]+\/[^/]+)\/blob\//i, "$1hf-mirror.com$2/resolve/");
  u = u.replace(/^(https?:\/\/)huggingface\.co/i, "$1hf-mirror.com");
  u = u.replace(/^(https?:\/\/)(www\.)?modelscope\.cn(\/models\/[^/]+\/[^/]+)\/blob\//i, "$1$2modelscope.cn$3/resolve/");
  return u;
}
function guessName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    return "";
  }
}
var KNOWN_CATS = [
  "checkpoints",
  "clip",
  "clip_vision",
  "controlnet",
  "diffusion_models",
  "embeddings",
  "loras",
  "style_models",
  "text_encoders",
  "unet",
  "upscale_models",
  "vae",
  "vae_approx",
  "configs"
];
function inferCategory(filename, url = "") {
  try {
    for (const seg of new URL(url).pathname.split("/")) {
      const s2 = decodeURIComponent(seg).toLowerCase();
      if (KNOWN_CATS.includes(s2)) return s2;
    }
  } catch {
  }
  const s = `${filename} ${url}`.toLowerCase();
  if (s.includes("lora")) return "loras";
  if (s.includes("controlnet")) return "controlnet";
  if (s.includes("vae")) return "vae";
  if (s.includes("upscale") || s.includes("esrgan")) return "upscale_models";
  if (s.includes("embedding") || s.includes("embedding")) return "embeddings";
  if (s.includes("text_encoder") || s.includes("t5") || s.includes("qwen")) return "text_encoders";
  if (s.includes("clip")) return "clip";
  if (s.includes("unet") || s.includes("diffusion")) return "diffusion_models";
  return "checkpoints";
}
function requestOnce(st, redirectsLeft) {
  const t2 = st.task;
  const tmp = t2.dest + ".downloading";
  return new Promise((resolve, reject) => {
    const offset = st.halt === "none" && import_node_fs4.default.existsSync(tmp) ? import_node_fs4.default.statSync(tmp).size : 0;
    t2.received = offset;
    const headers = { "user-agent": "comfyui-desk" };
    if (offset > 0) headers.range = `bytes=${offset}-`;
    const lib = t2.url.startsWith("http://") ? import_node_http.default : import_node_https.default;
    const req = lib.get(t2.url, { headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error(t("m.dl.errTooManyRedirects")));
        t2.url = new URL(res.headers.location, t2.url).toString();
        return resolve(requestOnce(st, redirectsLeft - 1));
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      if (offset > 0 && res.statusCode === 200) {
        t2.received = 0;
        import_node_fs4.default.rmSync(tmp, { force: true });
      }
      const ctype = String(res.headers["content-type"] || "");
      if (/text\/html/i.test(ctype) && MODEL_EXT.test(t2.filename)) {
        res.resume();
        return reject(new Error(t("m.dl.errNotModelFile")));
      }
      const append = res.statusCode === 206 && offset > 0;
      if (!t2.total) t2.total = Number(res.headers["content-length"] || 0) + (append ? offset : 0);
      const file = import_node_fs4.default.createWriteStream(tmp, { flags: append ? "a" : "w" });
      st.file = file;
      res.on("data", (d) => {
        t2.received += d.length;
        const now = Date.now();
        if (now - st.lastBytesAt >= 500) {
          t2.speed = Math.round((t2.received - st.lastBytes) * 1e3 / (now - st.lastBytesAt));
          st.lastBytes = t2.received;
          st.lastBytesAt = now;
        }
        emitSoon();
      });
      res.on("error", reject);
      file.on("error", reject);
      res.pipe(file);
      file.on("finish", () => {
        st.file = void 0;
        if (st.halt !== "none") return resolve();
        file.close(() => {
          try {
            import_node_fs4.default.rmSync(t2.dest, { force: true });
            import_node_fs4.default.renameSync(tmp, t2.dest);
            t2.status = "completed";
            if (!t2.total) t2.total = t2.received;
            t2.speed = 0;
            comfy.pushLog("sys", t("m.dl.logDone", { path: t2.dest }));
            emitNow();
            setTimeout(() => {
              const cur2 = states.get(t2.dest);
              if (cur2 && cur2.task.status === "completed") {
                states.delete(t2.dest);
                emitNow();
              }
            }, 3e3);
          } catch (e) {
            reject(e);
          }
        });
      });
      res.on("aborted", () => {
        if (st.halt !== "none") resolve();
      });
    });
    st.req = req;
    req.on("error", (e) => {
      if (st.halt !== "none") return resolve();
      reject(e);
    });
  });
}
async function runTask(st) {
  st.halt = "none";
  st.task.status = "downloading";
  st.task.error = void 0;
  st.lastBytes = st.task.received;
  st.lastBytesAt = Date.now();
  emitNow();
  try {
    await requestOnce(st, 5);
  } catch (e) {
    if (st.halt !== "none") return;
    st.task.status = "error";
    st.task.error = e.message;
    st.task.speed = 0;
    comfy.pushLog("sys", t("m.dl.logFailed", { filename: st.task.filename, error: st.task.error }));
    emitNow();
  }
}
async function startDownload(opts) {
  const url = normalizeUrl(opts.url, opts.useHfMirror);
  const rawName = (opts.filename || "").trim() || guessName(url);
  const filename = import_node_path4.default.basename(rawName || `download-${Date.now()}.bin`);
  const cats = modelCategories();
  const category = cats.includes(opts.category || "") ? opts.category : inferCategory(filename, url);
  const dir2 = import_node_path4.default.join(paths().models, category);
  import_node_fs4.default.mkdirSync(dir2, { recursive: true });
  const dest = import_node_path4.default.join(dir2, filename);
  const st = {
    task: {
      id: import_node_crypto.default.randomUUID(),
      url,
      category,
      filename,
      dest,
      received: 0,
      total: 0,
      speed: 0,
      status: "downloading",
      startedAt: Date.now()
    },
    lastBytes: 0,
    lastBytesAt: Date.now(),
    halt: "none"
  };
  if (states.has(dest)) return { ...states.get(dest).task };
  states.set(dest, st);
  comfy.pushLog(
    "sys",
    opts.useHfMirror ? t("m.dl.logStartMirror", { filename, category }) : t("m.dl.logStart", { filename, category })
  );
  void runTask(st);
  return { ...st.task };
}
function pauseDownload(id) {
  const st = find(id);
  if (!st || st.task.status !== "downloading") return;
  st.halt = "pause";
  st.task.status = "paused";
  st.task.speed = 0;
  st.req?.destroy();
  st.file?.destroy();
  comfy.pushLog("sys", t("m.dl.logPaused", { filename: st.task.filename }));
  emitNow();
}
function resumeDownload(id) {
  const st = find(id);
  if (!st || st.task.status !== "paused" && st.task.status !== "error") return;
  comfy.pushLog("sys", t("m.dl.logResumed", { filename: st.task.filename }));
  void runTask(st);
}
function cancelDownload(id) {
  const st = find(id);
  if (!st) return;
  st.halt = "cancel";
  st.req?.destroy();
  st.file?.destroy();
  import_node_fs4.default.rmSync(st.task.dest + ".downloading", { force: true });
  states.delete(st.task.dest);
  comfy.pushLog(
    "sys",
    t(st.task.status === "completed" ? "m.dl.logCleared" : "m.dl.logCanceled", { filename: st.task.filename })
  );
  emitNow();
}
function find(id) {
  for (const st of states.values()) if (st.task.id === id) return st;
  return void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cancelDownload,
  inferCategory,
  initDownloads,
  isModelUrl,
  listDownloads,
  modelBaseName,
  pauseDownload,
  resumeDownload,
  startDownload
});

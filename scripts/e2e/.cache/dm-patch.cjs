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

// src/shared/dm-patch.ts
var dm_patch_exports = {};
__export(dm_patch_exports, {
  comfyDmPatch: () => comfyDmPatch
});
module.exports = __toCommonJS(dm_patch_exports);
function comfyDmPatch() {
  const MARK = "__comfy_dm__";
  const READY = MARK + "ready";
  const MODEL_EXT_RE = /[\w.-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)([?#].*)?$/i;
  const SAVE_DIRS = [
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
  let lastHit = null;
  function basename(u) {
    try {
      return decodeURIComponent(u.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || "");
    } catch {
      return "";
    }
  }
  function isModelUrl(u) {
    return /^https?:\/\//i.test(u) && MODEL_EXT_RE.test(u);
  }
  function scrape(target) {
    const start = target?.closest?.("button, a");
    let cur = start;
    for (let i = 0; i < 8 && cur; i++) {
      const raw = (cur.innerText || "").trim();
      if (raw && raw.length < 4e3) {
        const text = raw.replace(/\s*\n\s*/g, "");
        const m = text.match(/([\w.-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft))/i);
        if (m) {
          const lines = raw.split("\n").map((l) => l.trim());
          let category = SAVE_DIRS.find((d) => lines.includes(d)) || "";
          if (!category) {
            const els = cur.querySelectorAll("*");
            for (let k = 0; k < els.length; k++) {
              const t = (els[k].textContent || "").trim();
              if (SAVE_DIRS.includes(t)) {
                category = t;
                break;
              }
            }
          }
          return { hit: { text, filename: m[1], category }, el: cur };
        }
      }
      cur = cur.parentElement;
    }
    return null;
  }
  function extractRows(container) {
    const rows = /* @__PURE__ */ new Map();
    const els = container.querySelectorAll("*");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const raw = (el.innerText || "").trim();
      if (!raw || raw.length > 800) continue;
      const text = raw.replace(/\s*\n\s*/g, "");
      const ms = text.match(/[\w.-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)/gi);
      if (!ms) continue;
      if (new Set(ms.map((x) => x.toLowerCase())).size !== 1) continue;
      const lines = raw.split("\n").map((l) => l.trim());
      let category = SAVE_DIRS.find((d) => lines.includes(d)) || "";
      if (!category) {
        const subs = el.querySelectorAll("*");
        for (let k = 0; k < subs.length; k++) {
          const t = (subs[k].textContent || "").trim();
          if (SAVE_DIRS.includes(t)) {
            category = t;
            break;
          }
        }
      }
      const fname = ms[0];
      if (!rows.has(fname) || !rows.get(fname) && category) rows.set(fname, category);
    }
    return [...rows].map(([filename, category]) => ({ filename, category }));
  }
  function modelNameCount(text) {
    const ms = text.match(/[\w.-]+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx|sft)/gi);
    return ms ? new Set(ms.map((x) => x.toLowerCase())).size : 0;
  }
  function report(url) {
    const base = basename(url);
    let filename = base;
    let category = "";
    if (lastHit && lastHit.text.includes(base)) {
      filename = lastHit.filename || base;
      category = lastHit.category;
    }
    lastHit = null;
    try {
      console.log(MARK + JSON.stringify({ url, filename, category }));
    } catch {
    }
  }
  function installListeners(w) {
    try {
      w.document.addEventListener("click", (e) => {
        const t = e.target;
        const a = t?.closest?.("a[href]");
        const href = a?.href;
        if (!href) return;
        if (isModelUrl(href)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          report(href);
        } else if (/^https?:\/\//i.test(href) && a.target === "_blank") {
          try {
            console.log(MARK + "dbg__ ext-link " + href);
          } catch {
          }
          e.preventDefault();
          w.open(href, "_blank");
        }
      }, true);
      w.document.addEventListener("mousedown", (e) => {
        const got = scrape(e.target);
        if (got) {
          lastHit = got.hit;
          const rows = modelNameCount(got.hit.text) > 1 ? extractRows(got.el) : void 0;
          try {
            console.log(MARK + "ctx__" + JSON.stringify({ text: got.hit.text, filename: got.hit.filename, category: got.hit.category, rows }));
          } catch {
          }
        }
      }, true);
    } catch {
    }
  }
  function patchFrame(w) {
    try {
      const rec = w;
      if (rec.__comfyDmPatched) return;
      rec.__comfyDmPatched = true;
      const origOpen = w.open.bind(w);
      rec.open = (u, t, f) => {
        const us = String(u ?? "");
        try {
          console.log(MARK + "dbg__ window.open " + us);
        } catch {
        }
        if (isModelUrl(us)) {
          report(us);
          return null;
        }
        return origOpen(us, t, f);
      };
      installListeners(w);
      const ob = new MutationObserver((records) => {
        records.forEach((r) => {
          r.addedNodes.forEach((n) => {
            const patchNested = (f) => {
              try {
                const cw = f.contentWindow;
                if (cw) patchFrame(cw);
              } catch {
              }
            };
            try {
              const el = n.nodeType === 1 ? n : null;
              if (!el) return;
              if (el.tagName === "IFRAME") patchNested(el);
              else el.querySelectorAll("iframe").forEach(patchNested);
            } catch {
            }
          });
        });
      });
      ob.observe(w.document.documentElement || w.document, { childList: true, subtree: true });
    } catch {
    }
  }
  patchFrame(window);
  try {
    console.log(MARK + "ready");
  } catch {
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  comfyDmPatch
});

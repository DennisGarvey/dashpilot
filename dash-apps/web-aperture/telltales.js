"use strict";

const symbols = {
  left: ["M3 12l8-8v5h10v6H11v5Z"],
  right: ["M21 12l-8-8v5H3v6h10v5Z"],
  hazards: ["M12 3 2 21h20Zm0 6v5m0 3h.01"],
  assistWarning: ["M12 3 2 21h20Zm0 6v5m0 3h.01"]
};

const regionalTelltales = new Set(["brake", "brakeBooster", "abs", "parkingBrake", "parkingBrakeFault"]);
const commonTelltales = {
  parkingLights: "parkingLights", lowBeam: "lowBeam", highBeam: "highBeam", autoHighBeam: "autoHighBeam",
  fog: "frontFog", traction: "stability", stability: "stability", tractionFault: "stability",
  stabilityFault: "stability", stabilityOff: "stabilityOff", belt: "belt", airbag: "airbag",
  tpms: "tpms", tpmsFault: "tpms", door: "door", reducedPower: "reducedPower",
  coldBattery: "coldBattery", limitedRegen: "limitedRegen"
};

function renderTelltales(container, values, definitions, region) {
  const active = Object.entries(definitions).filter(([key]) => values?.[key]);
  const signature = JSON.stringify([region, active.map(([key]) => [key, values[key]])]);
  if (container.dataset.active === signature) return;
  container.dataset.active = signature;

  const ns = "http://www.w3.org/2000/svg";
  container.replaceChildren(...active.map(([key, [label, color]]) => {
    const flashing = values[key] === "flash" || key === "tpmsFault";
    const image = regionalTelltales.has(key) ? key + (region === "us" ? "-us" : "-ca") :
      key === "autoHighBeam" && values[key] === "standby" ? "adaptiveStandby" : commonTelltales[key];
    const classes = "lamp " + color + (flashing ? " flash" : "");
    if (key === "rearFog") {
      const icon = document.createElement("span");
      icon.setAttribute("role", "img");
      icon.setAttribute("aria-label", label);
      icon.title = label;
      icon.className = classes + " manufacturer rear-fog";
      return icon;
    }
    if (image) {
      const icon = document.createElement("img");
      icon.src = "icons/" + image + ".png";
      icon.alt = label;
      icon.title = label;
      icon.className = classes + " manufacturer";
      return icon;
    }
    const [shape, letters, textY = 15] = symbols[key];
    const icon = document.createElementNS(ns, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", label);
    icon.setAttribute("class", classes);
    const title = document.createElementNS(ns, "title");
    title.textContent = label;
    icon.append(title);
    if (shape) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", shape);
      icon.append(path);
    }
    if (letters) {
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", "12");
      text.setAttribute("y", String(textY));
      text.textContent = letters;
      icon.append(text);
    }
    return icon;
  }));
}

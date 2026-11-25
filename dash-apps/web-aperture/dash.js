"use strict";

const $ = id => document.getElementById(id);
const write = (id, value) => { $(id).textContent = value; };
const finite = Number.isFinite;
const clamp = value => Math.min(1, Math.max(0, value));
const speedIn = (value, from, to) => from === to ? value : from === "mph" ? value * 1.609344 : value / 1.609344;
const display = (value, unit, digits = 0) => finite(value) ? value.toFixed(digits) + " " + unit : "—";
const panelNames = {
  frontLeft: "Front left", frontRight: "Front right", rearLeft: "Rear left", rearRight: "Rear right",
  frunk: "Frunk", liftgate: "Liftgate", chargePort: "Charge port"
};
const lamps = {
  left: ["←", "green"], right: ["→", "green"],
  parkingLights: ["Parking lights", "green"], lowBeam: ["LOW BEAM", "green"], highBeam: ["HIGH BEAM", "blue"], autoHighBeam: ["Adaptive headlights", "blue"],
  fog: ["FOG", "green"], parkingBrake: ["P BRAKE", "red"], brake: ["Brake system", "red"], brakeBooster: ["Brake booster fault", "amber"],
  parkingBrakeFault: ["Parking brake fault", "amber"],
  abs: ["ABS", "amber"], hold: ["Vehicle Hold", "neutral"], traction: ["TC", "amber"],
  stability: ["ESC", "amber"], tractionFault: ["TC FAULT", "amber"],
  stabilityFault: ["ESC FAULT", "amber"], stabilityOff: ["ESC OFF", "amber"],
  belt: ["SEAT BELT", "red"], airbag: ["AIRBAG", "red"], tpms: ["LOW TIRE", "amber"],
  tpmsFault: ["TPMS FAULT", "amber"], door: ["CLOSURE", "red"], reducedPower: ["POWER LIMIT", "amber"],
  coldBattery: ["Cold battery", "blue"], limitedRegen: ["Limited regeneration", "green"], assistWarning: ["ASSIST", "amber"]
};

function tags(element, entries) {
  element.replaceChildren(...entries.map(([label, className]) => {
    const item = document.createElement("span");
    item.textContent = label;
    if (className) item.className = className;
    return item;
  }));
}

function renderPower(p) {
  $("power").hidden = !finite(p?.used) && !finite(p?.driveFraction) && !finite(p?.regenFraction);
  const regen = p?.used < 0;
  const available = regen ? p?.regenFraction : p?.driveFraction;
  const fill = finite(p?.used)
    ? 50 * Math.min(clamp(Math.abs(p.used)), finite(available) ? clamp(available) : 1)
    : 0;
  $("regenLimit").style.width = (finite(p?.regenFraction) ? 50 * (1 - clamp(p.regenFraction)) : 0) + "%";
  $("driveLimit").style.width = (finite(p?.driveFraction) ? 50 * (1 - clamp(p.driveFraction)) : 0) + "%";
  Object.assign($("powerFill").style, {
    width: fill + "%", left: (regen ? 50 - fill : 50) + "%",
    background: regen ? "var(--green)" : "var(--power-active)"
  });
}

function renderLanePreview(angle, assist) {
  // Approximate road-wheel angle and wheelbase for the simulated preview.
  const steeringMagnitude = finite(angle) ? Math.abs(angle) : 0;
  const previewMagnitude = steeringMagnitude <= 60 ? steeringMagnitude :
    Math.min(180, 60 + (steeringMagnitude - 60) * 2.4);
  const steeringWheelDegrees = previewMagnitude === 0 ? 0 : Math.sign(angle) * previewMagnitude;
  const steeringRatio = 15;
  const steeringLock = Math.abs(steeringWheelDegrees) / 180;
  const wheelbase = 2.9;
  const curvature = Math.tan(steeringWheelDegrees / steeringRatio * Math.PI / 180) / wheelbase;

  function roadDistance(y) {
    const depth = (410 - y) / 410;
    // Add most of the bend near full lock and well ahead of the car.
    const farPreview = 1 + .36 * steeringLock ** 2 * depth ** 2
      + .85 * steeringLock ** 4 * depth ** 5;
    return 7 * depth * farPreview / (1 - .65 * depth);
  }

  function project(y, offset = 0) {
    const depth = (410 - y) / 410;
    const scale = 1 - .85 * depth;
    // A convex screen-space curve keeps the horizon from curling back at full lock.
    const bend = curvature * (1470 * depth ** 2 + (950 + 900 * steeringLock ** 2) * depth ** 4);
    return 300 + offset * scale + bend;
  }

  const carY = 270;
  const laneShift = project(carY) - 300;

  function lanePoints(offset, start, end) {
    return Array.from({ length: 25 }, (_, i) => {
      const y = start + (end - start) * i / 24;
      return (project(y, offset) - laneShift).toFixed(2) + " " + y.toFixed(2);
    });
  }

  const scene = $("scene");

  // Measure the projected centerline at the car, accounting for the stretched SVG viewBox.
  const aspect = scene.clientWidth && scene.clientHeight
    ? (scene.clientWidth / 600) / (scene.clientHeight / 400) : 1;
  const screenSlope = (project(carY - 1) - project(carY + 1)) * aspect / 2;
  // The atlas views the car from an elevation whose sine is about 0.605.
  const atlasHeading = Math.atan(screenSlope * .605) * 180 / Math.PI;
  const frame = 9 - Math.max(-9, Math.min(9, atlasHeading / 2));
  const firstFrame = Math.floor(frame);
  const position = index => ((index % 7) / 6 * 100) + "% " + (Math.floor(index / 7) * 50) + "%";
  for (const [id, index] of [["drivingCar", firstFrame], ["drivingCarBlend", Math.ceil(frame)]]) {
    $(id).style.setProperty("--view-frame", position(index));
  }
  $("drivingCarBlend").style.opacity = frame - firstFrame;
  const laneEnd = 0;
  for (const [id, offset] of [["laneShoulderLeft", -215], ["laneShoulderRight", 215]]) {
    $(id).setAttribute("d", "M" + lanePoints(offset, 410, laneEnd).join(" L"));
  }
  if (assist === "ap") {
    drawLaneDashes = null;
    $("laneLeft").setAttribute("d", "M" + lanePoints(-93, 410, laneEnd).join(" L"));
    $("laneRight").setAttribute("d", "M" + lanePoints(93, 410, laneEnd).join(" L"));
  } else {
    const distances = Array.from({ length: 83 }, (_, i) => roadDistance(410 - i * 5));
    const farDistance = distances.at(-1);
    function projectedY(distance) {
      let lo = 0, hi = distances.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (distances[mid] <= distance) lo = mid;
        else hi = mid;
      }
      const fraction = (distance - distances[lo]) / (distances[hi] - distances[lo]);
      return 410 - (lo + fraction) * 5;
    }
    drawLaneDashes = phase => {
      const left = [], right = [];
      for (let start = -phase; start < farDistance; start += laneDashPeriod) {
        const near = Math.max(0, start);
        const far = Math.min(farDistance, start + laneDashLength);
        if (far <= near) continue;
        for (let i = 0; i <= 4; i++) {
          const distance = near + (far - near) * i / 4;
          const y = projectedY(distance);
          const command = i === 0 ? "M" : "L";
          left.push(command + (project(y, -93) - laneShift).toFixed(2) + " " + y.toFixed(2));
          right.push(command + (project(y, 93) - laneShift).toFixed(2) + " " + y.toFixed(2));
        }
      }
      $("laneLeft").setAttribute("d", left.join(" "));
      $("laneRight").setAttribute("d", right.join(" "));
    };
    drawLaneDashes(laneDashOffset);
  }
  // The front bumper sits about a quarter of a tile above the sprite center.
  const sceneHeight = scene.clientHeight || 400;
  const carHeight = $("drivingCar").clientHeight || 148;
  const bumperY = Math.max(72, carY - carHeight * .255 * 400 / sceneHeight);
  const sceneWidth = scene.clientWidth || 600;
  const ribbonEnd = bumperY + carHeight * .12 * 400 / sceneHeight;
  const endScale = 1 - .85 * (410 - ribbonEnd) / 410;
  if (assist === "nav") {
    const navHalfWidth = 4 * 600 / (sceneWidth * endScale);
    const left = lanePoints(-navHalfWidth, ribbonEnd, laneEnd);
    const right = lanePoints(navHalfWidth, laneEnd, ribbonEnd);
    $("navRoute").setAttribute("d", "M" + [...left, ...right].join(" L") + " Z");
  }
  if (assist !== "fsd") return;
  const ribbonHalfWidth = Math.min(51, carHeight * .30 * 300 / (sceneWidth * endScale));
  const routeLeft = lanePoints(-ribbonHalfWidth, ribbonEnd, laneEnd);
  const routeRight = lanePoints(ribbonHalfWidth, laneEnd, ribbonEnd);
  $("laneRoute").setAttribute("d", "M" + [...routeLeft, ...routeRight].join(" L") + " Z");
}

const laneDashLength = 3;
const laneDashPeriod = 8;
let drawLaneDashes = null;
let laneMotionSpeed = 0;
let laneDashOffset = 0;
let laneAnimationFrame = null;
let lastLaneTick;

function animateLaneDashes(time) {
  const elapsed = lastLaneTick === undefined ? 0 : Math.min(time - lastLaneTick, 50) / 1000;
  lastLaneTick = time;
  laneDashOffset = (laneDashOffset + laneMotionSpeed * elapsed) % laneDashPeriod;
  drawLaneDashes?.(laneDashOffset);
  laneAnimationFrame = requestAnimationFrame(animateLaneDashes);
}

function updateLaneMotion(speed) {
  laneMotionSpeed = speed;
  if (typeof requestAnimationFrame !== "function") return;
  if (speed > 0 && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    if (laneAnimationFrame === null) laneAnimationFrame = requestAnimationFrame(animateLaneDashes);
  } else if (laneAnimationFrame !== null) {
    cancelAnimationFrame(laneAnimationFrame);
    laneAnimationFrame = null;
    lastLaneTick = undefined;
  }
}

let alertPulseFrame = null;
let alertPulseStarted;
let alertPulseLastTick;
let alertPulsePhase = 0;

function pulseAlert(time) {
  alertPulseStarted ??= time;
  const elapsed = (time - alertPulseStarted) / 1000;
  const delta = alertPulseLastTick === undefined ? 0 : Math.min(time - alertPulseLastTick, 50) / 1000;
  alertPulseLastTick = time;
  const period = 1.8 - 1.1 * clamp(elapsed / 12);
  alertPulsePhase += delta / period;
  const glow = .36 + .64 * (.5 + .5 * Math.cos(2 * Math.PI * alertPulsePhase));
  $("cluster").style.setProperty("--alert-glow", glow.toFixed(3));
  alertPulseFrame = requestAnimationFrame(pulseAlert);
}

function updateAlertPulse(escalated) {
  if (typeof requestAnimationFrame !== "function") return;
  if (escalated && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    if (alertPulseFrame === null) alertPulseFrame = requestAnimationFrame(pulseAlert);
  } else if (alertPulseFrame !== null) {
    cancelAnimationFrame(alertPulseFrame);
    alertPulseFrame = null;
    alertPulseStarted = undefined;
    alertPulseLastTick = undefined;
    alertPulsePhase = 0;
    $("cluster").style.removeProperty("--alert-glow");
  }
}

const driverPrompts = {
  turning: "Apply slight turning force to steering wheel",
  attention: "Please pay attention to the road"
};

const attentionReasons = new Set([30, 41, 47, 48, 49, 54, 55, 56, 57, 58, 59, 60, 61, 62]);
const steeringReasons = new Set([38, 43, 52]);

function driverWarning(raw, assist) {
  if (raw.autopilotState === 8 || raw.autopilotAborting === true || raw.autopilotAborting === 1) return "takeover";
  if (assist !== "ap" && assist !== "nav" && assist !== "fsd") return undefined;
  if (![3, 4, 5, 9, 10].includes(raw.autopilotHandsOnState)) return undefined;
  if (attentionReasons.has(raw.handsOnReason)) return "attention";
  if (steeringReasons.has(raw.handsOnReason)) return "turning";
  if (raw.handsOnReason === 0 && raw.attentionBasedDriverMonitorOn === false) return "turning";
  return undefined;
}

const exteriorPaintCodes = new Set([0, 1, 2, 3, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 20]);

const lightingAndSystems = new Set(["parkingLights", "lowBeam", "highBeam", "autoHighBeam",
  "fog", "tpms", "tpmsFault", "coldBattery", "limitedRegen", "airbag"]);
const leftLamps = Object.fromEntries(Object.entries(lamps).filter(([key]) => lightingAndSystems.has(key)));
const rightLamps = Object.fromEntries(Object.entries(lamps).filter(([key]) =>
  !lightingAndSystems.has(key) && key !== "left" && key !== "right"));
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function render(s) {
  document.body.classList.toggle("night", !!s.darkMode);
  const paint = exteriorPaintCodes.has(s.exteriorColor) ? s.exteriorColor : undefined;
  const scene = $("scene");
  if (paint !== undefined) {
    scene.style.setProperty("--drive-paint", 'url("paint/drive-' + paint + '.webp")');

  } else {
    scene.style.removeProperty("--drive-paint");

  }
  const parked = s.gear === 1;
  const navigating = s.assist === "nav";
  const autopilot = s.assist === "ap" || navigating;
  const fsd = s.assist === "fsd";
  const charging = s.charge != null;
  const takeover = s.driverWarning === "takeover";
  const carImage = "paint/charge-" + (paint ?? 6) + ".webp";
  const portrait = $(charging ? "chargingCar" : "parkedCar");
  if ((parked || charging) && portrait.getAttribute("src") !== carImage) portrait.setAttribute("src", carImage);
  $("cluster").classList.toggle("park-view", parked && !charging);
  $("gears").hidden = charging;
  $("scene").hidden = takeover;
  $("takeover").hidden = !takeover;
  const prompt = driverPrompts[s.driverWarning];
  $("roadPrompt").hidden = !prompt;
  if ($("roadPromptText").textContent !== (prompt ?? "")) write("roadPromptText", prompt ?? "");
  const escalated = !!prompt && !!s.driverWarningEscalated;
  $("cluster").classList.toggle("prompt-escalated", escalated);
  updateAlertPulse(escalated);
  $("cluster").classList.toggle("charging", charging);
  $("drive").hidden = charging;
  $("driveBadges").hidden = parked;
  $("charge").hidden = !charging;
  $("scene").classList.toggle("parked", parked);
  $("scene").classList.toggle("guided", autopilot || fsd);
  $("scene").classList.toggle("autopilot-lane", s.assist === "ap");
  $("scene").classList.toggle("nav-route-active", navigating);
  $("scene").classList.toggle("fsd-route", fsd);
  if (!parked) renderLanePreview(s.angle, s.assist);
  const moving = !parked && !charging && !takeover && s.assist !== "ap" && finite(s.speed);
  updateLaneMotion(moving ? Math.max(0, speedIn(s.speed, s.units, "km/h")) / 3.6 : 0);
  write("vehicleTitle", parked ? "PARKED VEHICLE" : "DRIVING VIEW");
  write("vehicleStatus", parked ? "" : s.locked === true ? "LOCKED" : s.locked === false ? "UNLOCKED" : "");
  tags($("gears"), [..."PRND"].map((gear, i) => [gear, s.gear === i + 1 ? ((autopilot || fsd) && gear === "D" ? "selected auto" : "selected") : ""]));
  write("speed", finite(s.speed) ? Math.round(s.speed) : "—");
  write("units", s.units);
  write("secondary", finite(s.speed) && s.mapUnits && s.mapUnits !== s.units
    ? display(speedIn(s.speed, s.units, s.mapUnits), s.mapUnits) : "");
  const autosteerReady = s.assist === "ready";
  $("assist").hidden = parked || (!autopilot && !autosteerReady);
  $("assistValue").parentElement.hidden = !autopilot;
  $("fsdProfile").hidden = parked || !fsd;
  write("fsdProfileValue", fsd ? s.profile ?? "—" : "");
  const wheel = $("wheel");
  wheel.hidden = !autopilot && !autosteerReady;
  wheel.src = autopilot ? "icons/autosteer-active.png" : "icons/autosteer-ready.png";
  wheel.alt = autopilot ? "Autopilot active" : "Autosteer available";
  wheel.style.transform = "rotate(" + (autopilot && finite(s.angle) ? s.angle : 0) + "deg)";
  write("assistValue", finite(s.setSpeed) ? Math.round(s.setSpeed) : "—");
  $("sign").hidden = parked || !finite(s.limit) || s.limit <= 0;
  $("sign").classList.toggle("ring", s.region === "eu");
  $("sign").classList.toggle("canada", s.region === "ca");
  $("signLabel").hidden = s.region === "eu";
  $("signLabel").innerHTML = s.region === "ca" ? "MAXIMUM" : "SPEED<br>LIMIT";
  $("sign").classList.toggle("three-digits", Math.round(s.limit) >= 100);
  write("limit", finite(s.limit) ? Math.round(s.limit) : "—");
  $("sign").setAttribute("aria-label", "Posted speed limit " + display(s.limit, s.mapUnits ?? s.units));
  renderPower(charging ? undefined : parked ? { used: 0 } : s.power);

  const demoHazards = s.lamps?.left === "flash" && s.lamps?.right === "flash";
  $("turnArrows").classList.toggle("signals-flash", demoHazards);
  for (const [key, id] of [["left", "turnArrowLeft"], ["right", "turnArrowRight"]]) {
    const state = s.lamps?.[key];
    $(id).setAttribute("aria-hidden", state ? "false" : "true");
    $(id).classList.toggle("signal-active", !!state);
    $(id).classList.toggle("signals-flash", state === "flash" && !demoHazards);
    $(id).classList.toggle("signal-muted", state === "muted");
  }
  renderTelltales($("telltalesLeft"), s.lamps, leftLamps, s.market ?? s.region);
  renderTelltales($("telltalesRight"), s.lamps, rightLamps, s.market ?? s.region);
  const alert = $("alert");
  const alertText = takeover || prompt || parked ? "" : s.alert ?? "";
  if (alert.textContent !== alertText) alert.textContent = alertText;
  const closures = [];
  for (const panel of document.querySelectorAll("[data-panel]")) {
    const key = panel.dataset.panel;
    const state = s.closures?.[key] ?? "unknown";
    const moving = state === "opening" || state === "closing";
    panel.classList.toggle("open", state === "open" || moving);
    for (const name of ["ajar", "fault", "unknown"]) panel.classList.toggle(name, state === name);
    panel.title = panelNames[key] + " · " + state;
    if (!parked && ["open", "ajar", "fault", "opening", "closing"].includes(state)) {
      closures.push([panelNames[key] + " · " + state]);
    }
  }
  $("closures").hidden = parked || takeover || !closures.length;
  tags($("closures"), closures);
  $("cable").hidden = !s.plugged;
  if (finite(s.liftgateAngle)) $("scene").style.setProperty("--lift", -clamp(s.liftgateAngle / 80) * 25 + "px");
  else $("scene").style.removeProperty("--lift");

  if (charging) {
    const c = s.charge;
    const ac = c.kind === "ac";
    $("charge").classList.toggle("charging-ac", ac);
    const remaining = finite(c.minutes) ? Math.max(0, Math.round(c.minutes)) : undefined;
    const hours = Math.floor(remaining / 60);
    const minutes = remaining % 60;
    write("chargeTime", remaining === undefined ? "—" : hours ? hours + " h " + minutes + " min" : minutes + " min");
    write("chargePower", display(c.kw, "kW", c.kw < 20 ? 1 : 0));
    $("chargePowerLabel").hidden = !ac;
    $("chargeRateRow").hidden = ac || !finite(c.rangeRateMiles);
    write("chargeRate", display(speedIn(c.rangeRateMiles, "mph", s.units), s.units === "mph" ? "mi/h" : "km/h"));
    const acLimit = c.evseAcCurrentLimit ?? c.CP_evseAcCurrentLimit;
    const hasAcLimit = ac && finite(acLimit) && acLimit > 0;
    const current = amps => amps.toFixed(Number.isInteger(amps) ? 0 : 1);
    const phases = c.numPhases ?? c.CC_numPhases;
    const showPhases = ac && [2, 3].includes(phases);
    $("chargeElectrical").hidden = !ac || (!finite(c.volts) && !finite(c.amps));
    $("chargePhases").hidden = !showPhases;
    if (showPhases) {
      write("chargePhases", phases);
      $("chargePhases").setAttribute("aria-label", phases + "-phase AC");
    }
    write("volts", finite(c.volts) ? display(c.volts, "V") : "");
    write("amps", finite(c.amps) ? current(c.amps) + (hasAcLimit ? "/" + current(acLimit) : "") + " A" : "");
    write("energy", display(c.energy, "kWh", 1));
    const rangeAdded = finite(c.ratedRangeMiles) && finite(c.startRatedRangeMiles)
      ? speedIn(Math.max(0, c.ratedRangeMiles - c.startRatedRangeMiles), "mph", s.units)
      : c.range;
    write("range", display(rangeAdded, s.units === "mph" ? "mi" : "km"));
    write("chargeBasis", c.basis ?? "");
  }
  const batteryStatus = $("batteryStatus");
  batteryStatus.hidden = !finite(s.soc);
  const enoughEnergy = s.enoughEnergyForConvenienceFeatures;
  const lowPower = enoughEnergy === false || enoughEnergy === 0 ||
    (enoughEnergy !== true && enoughEnergy !== 1 && s.soc <= 20);
  batteryStatus.classList.toggle("battery-low", finite(s.soc) && s.soc > 5 && lowPower);
  batteryStatus.classList.toggle("battery-critical", finite(s.soc) && s.soc <= 5);
  $("batteryLevel").style.width = (finite(s.soc) ? clamp(s.soc / 100) * 100 : 0) + "%";
  write("batteryPercent", finite(s.soc) ? Math.round(s.soc) + "%" : "");
  write("ambientTemperature", finite(s.outside) ? display(s.outside, s.imperial ? "°F" : "°C") : "");
  write("clock", clockFormat.format(finite(s.currentTime) && s.currentTime > 0 ? s.currentTime : Date.now()));
}

let chargeBaseline;
function readCharge(raw) {
  const plugged = raw.chargeType === 1 || raw.chargeType === 2;
  if (raw.chargeType === 0) chargeBaseline = undefined;
  if (!plugged || raw.chargeTransferState !== 5) return undefined;

  const reading = value => finite(value) && value >= 0 ? value : undefined;
  const ratedRange = reading(raw.ratedRangeMiles);
  const meter = reading(raw.chargeMeterKwh);
  chargeBaseline ??= {};
  chargeBaseline.energy ??= meter;
  chargeBaseline.range ??= ratedRange;
  const ac = raw.chargeType === 2;
  return {
    kind: ac ? "ac" : "dc",
    minutes: reading(raw.chargeMinutes),
    kw: reading(ac ? raw.chargeInputKw : raw.batteryInputKw),
    volts: reading(raw.chargeVolts),
    amps: reading(raw.chargeAmps),
    evseAcCurrentLimit: reading(raw.evseAcCurrentLimit),
    numPhases: reading(raw.chargePhases),
    energy: meter !== undefined && chargeBaseline.energy !== undefined
      ? Math.max(0, meter - chargeBaseline.energy) : undefined,
    ratedRangeMiles: ratedRange,
    startRatedRangeMiles: chargeBaseline.range,
  };
}

function liveTelltales(mask) {
  const on = bit => (mask & (1 << bit)) !== 0;
  return {
    parkingLights: on(0), lowBeam: on(1), highBeam: on(2),
    autoHighBeam: on(3) && (on(2) || "standby"), fog: on(4), hold: on(5),
    stability: on(7) ? "flash" : on(6), traction: on(9) ? "flash" : on(8),
    airbag: on(10), tpms: on(11) && !on(12), tpmsFault: on(12), abs: on(13),
  };
}

function fromDashPilot(raw) {
  const appUnits = raw.isImperial ? "mph" : "km/h";
  const carUnits = raw.distanceUnits === 1 ? "mph" : raw.distanceUnits === 0 ? "km/h" : appUnits;
  const mapUnits = raw.mapSpeedUnits === 1 ? "km/h" : raw.mapSpeedUnits === 0 ? "mph" : undefined;
  const hasSpeed = raw.gear && !(raw.dataSourceType === "dashkit" && raw.uiSpeedUnits === -1);
  const nativeSpeedUnits = raw.egoSpeedUnits ?? (raw.uiSpeedUnits === 1 ? "km/h" : raw.uiSpeedUnits === 0 ? "mph" : carUnits);
  const closureState = value => value == null ? "unknown" : value ? "open" : "closed";
  const capacity = raw.fullPackEnergy - raw.energyBuffer;
  const autosteerReady = raw.autopilotState === 2 && (raw.fsdEnabled === false || raw.fsdEnabled === 0) && raw.autosteerAvailable !== false;
  const assist = raw.autopilotState === 6 ? "fsd" : raw.autopilotState === 5 ? "nav" :
    [3, 4].includes(raw.autopilotState) ? "ap" :
    autosteerReady ? "ready" : undefined;
  const profiles = ["Chill", "Normal", "Assertive", "Mad Max", "Conservative"];
  return {
    gear: raw.gear, speed: hasSpeed ? speedIn(raw.egoSpeed, nativeSpeedUnits, carUnits) : undefined,
    units: carUnits, mapUnits, region: raw.market === "ca" ? "ca" : raw.mapRegion === 1 ? "eu" : "us",
    market: raw.market,
    limit: raw.mapLimit > 0 ? raw.mapLimit : raw.fusedSpeedLimit < 155 ? raw.fusedSpeedLimit : undefined,
    assist, profile: profiles[raw.drivingProfile], angle: raw.egoSteeringAngle,
    driverWarning: driverWarning(raw, assist),
    driverWarningEscalated: [4, 5, 9, 10].includes(raw.autopilotHandsOnState),
    setSpeed: raw.accSetSpeed > 0 ? speedIn(raw.accSetSpeed, nativeSpeedUnits, carUnits) : undefined,
    power: raw.power ?? { used: raw.powerLevel / 100 },
    closures: raw.closures ?? {
      frontLeft: closureState(raw.doorOpenFL), frontRight: closureState(raw.doorOpenFR),
      rearLeft: closureState(raw.doorOpenRL), rearRight: closureState(raw.doorOpenRR),
      frunk: closureState(raw.frunkOpen), liftgate: closureState(raw.trunkOpen),
    },
    liftgateAngle: raw.trunkPosition, windows: raw.windows, locked: raw.locked,
    charge: raw.charge ? { ...raw.charge, evseAcCurrentLimit: raw.charge.evseAcCurrentLimit ?? raw.evseAcCurrentLimit ?? raw.CP_evseAcCurrentLimit } : readCharge(raw),
    plugged: raw.plugged ?? (raw.chargeType === 1 || raw.chargeType === 2),
    lamps: { ...liveTelltales(raw.telltaleBits), ...raw.telltales,
      left: raw.leftBlinker == null ? raw.telltales?.left : raw.leftBlinker === 2 || (raw.leftBlinker === 1 && "muted"),
      right: raw.rightBlinker == null ? raw.telltales?.right : raw.rightBlinker === 2 || (raw.rightBlinker === 1 && "muted"),
      door: !!raw.anyDoorOpen, belt: raw.buckleStatus === 0 },
    alert: raw.driverAlert ?? (raw.changingLane ? "Changing lane" :
      raw.speedCameraDistance > 0 ? "Speed camera · " + raw.speedCameraDistance + " m" : ""),
    imperial: raw.isImperial, currentTime: raw.currentTime,
    darkMode: [0, 1, false, true].includes(raw.displayInDarkMode) ? !!raw.displayInDarkMode : raw.darkMode,
    exteriorColor: raw.exteriorColor,
    enoughEnergyForConvenienceFeatures: raw.enoughEnergyForConvenienceFeatures ?? raw.BMS_enoughEnergyForConvenienceFe,
    outside: raw.ambientTempC > -100 ? (raw.isImperial ? raw.ambientTempC * 1.8 + 32 : raw.ambientTempC) : undefined,
    soc: raw.showCarBattery === false ? undefined : finite(raw.soc) && raw.soc >= 0 ? raw.soc :
      capacity > 0 && raw.nominalEnergyRemaining > 0 ? clamp((raw.nominalEnergyRemaining - raw.energyBuffer) / capacity) * 100 : undefined,
  };
}

const nativeKeys = [
  "egoSpeed", "gear", "egoSteeringAngle", "leftBlinker", "rightBlinker", "accSetSpeed", "fusedSpeedLimit",
  "anyDoorOpen", "doorOpenFL", "doorOpenFR", "doorOpenRL", "doorOpenRR", "trunkOpen", "trunkPosition",
  "frunkOpen", "buckleStatus", "isImperial", "showCarBattery", "nominalEnergyRemaining", "energyBuffer",
  "fullPackEnergy", "powerLevel", "currentTime",
  "speedCameraDistance", "changingLane", "dataSourceType", "distanceUnits", "mapSpeedUnits", "mapRegion",
  "mapLimit", "market", "fsdEnabled", "autosteerAvailable", "autopilotState", "autopilotAborting", "autopilotHandsOnState", "handsOnReason", "attentionBasedDriverMonitorOn", "drivingProfile", "ambientTempC", "darkMode", "displayInDarkMode", "exteriorColor", "enoughEnergyForConvenienceFeatures",
  "uiSpeedUnits", "soc", "chargeTransferState", "chargeType", "chargeMinutes", "ratedRangeMiles", "chargeVolts", "chargeAmps", "chargeInputKw", "evseAcCurrentLimit", "chargePhases", "batteryInputKw", "chargeMeterKwh", "telltaleBits"
];

let live = false;
let lastUpdate = 0;
window.receiveMessage = raw => {
  live = true;
  lastUpdate = Date.now();
  document.body.classList.add("embedded");
  $("demo").hidden = true;
  document.body.classList.remove("waiting-for-feed");
  write("status", "DASHPILOT FEED");
  render(fromDashPilot(raw));
};
window.onCarStateUpdate = () => {
  const native = window.NativeCarState;
  if (!native) return;
  const raw = {};
  for (const key of nativeKeys) {
    const suffix = key[0].toUpperCase() + key.slice(1);
    raw[key] = native["get" + suffix]?.() ?? native["is" + suffix]?.() ??
      (key.startsWith("is") ? native[key]?.() : undefined);
  }
  window.receiveMessage(raw);
};

let mode = "ap";
function demo() {
  if (live) return;
  const parked = ["park", "ac", "dc"].includes(mode);
  const plugged = mode === "ac" || mode === "dc";
  const dc = mode === "dc";
  const imperial = $("appUnits").value === "imperial";
  const units = $("carUnits").value;
  const region = $("map").value;
  const test = $("warnings").checked;
  const signal = $("demoTurnSignals").value;
  const soc = Number($("demoBattery").value);
  write("demoBatteryValue", soc + "%");
  const activeLamps = test ? Object.fromEntries(Object.keys(lamps).map(name => [name, true])) :
    parked ? { parkingBrake: true } : { highBeam: mode === "ap" };
  activeLamps.left = signal === "left" || signal === "hazards" ? "flash" : false;
  activeLamps.right = signal === "right" || signal === "hazards" ? "flash" : false;
  const closures = Object.fromEntries(Object.keys(panelNames).map(name => [name, "closed"]));
  if (mode === "park") Object.assign(closures, { frontLeft: "open", rearRight: "ajar", frunk: "open", liftgate: "open" });
  if (plugged) closures.chargePort = "open";
  render({
    gear: parked ? 1 : 4, assist: mode, profile: $("demoFsdProfile").value, angle: Number($("steering").value),
    units, mapUnits: region === "us" ? "mph" : "km/h", region,
    speed: parked ? 0 : speedIn(Number($("demoSpeed").value), "km/h", units),
    setSpeed: speedIn(113, "km/h", units), limit: region === "us" ? 65 : 100,
    power: parked ? { used: 0 } : { used: mode === "fsd" ? -.34 : .42, driveFraction: .79, regenFraction: .73 },
    lamps: activeLamps, closures, plugged, locked: parked && mode !== "park", liftgateAngle: 68,
    windows: mode === "park" ? { frontLeft: 35 } : undefined,
    driverWarning: parked ? undefined : $("demoAlert").value,
    driverWarningEscalated: $("demoAlertEscalated").checked,
    charge: plugged ? { kind: dc ? "dc" : "ac", rangeRateMiles: dc ? 410 : 13, volts: dc ? 392 : 240,
      amps: dc ? 310 : 16, evseAcCurrentLimit: dc ? undefined : 32, kw: dc ? 121.5 : 3.84, energy: dc ? 23.4 : 8.6,
      ratedRangeMiles: 201, startRatedRangeMiles: dc ? 113 : 169, minutes: dc ? 14 : 95 } : undefined,
    soc, enoughEnergyForConvenienceFeatures: Number($("demoConvenienceEnergy").value), darkMode: $("demoDarkMode").checked, exteriorColor: Number($("demoPaint").value), imperial, outside: imperial ? 61 : 16,
  });
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.setAttribute("aria-pressed", button.dataset.mode === mode);
  }
}

for (const button of document.querySelectorAll("[data-mode]")) {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    demo();
  });
}
for (const input of document.querySelectorAll(".controls input, .controls select")) {
  input.addEventListener("input", demo);
}
window.addEventListener("resize", demo);
if (window.NativeCarState) {
  window.onCarStateUpdate();
} else if (location.protocol === "app:") {
  document.body.classList.add("embedded", "waiting-for-feed");
  $("demo").hidden = true;
  live = true;
  lastUpdate = Date.now();
  write("status", "WAITING FOR DATA");
  render(fromDashPilot({}));
} else {
  demo();
}

setInterval(() => {
  if (!live || Date.now() - lastUpdate < 2000) return;
  document.body.classList.add("waiting-for-feed");
  write("status", "SIGNAL LOST");
  render(fromDashPilot({}));
}, 500);

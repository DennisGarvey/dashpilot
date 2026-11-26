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
  fog: ["Front fog lights", "green"], rearFog: ["Rear fog lights", "amber"], parkingBrake: ["P BRAKE", "red"], brake: ["Brake system", "red"], brakeBooster: ["Brake booster fault", "amber"],
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
  $("power").hidden = !p;
  const regen = p?.used < 0;
  const available = regen ? p?.regenFraction : p?.driveFraction;
  const fill = finite(p?.used)
    ? 50 * Math.min(clamp(Math.abs(p.used)), finite(available) ? clamp(available) : 1)
    : 0;
  $("regenLimit").style.width = (finite(p?.regenFraction) ? 50 * (1 - clamp(p.regenFraction)) : 0) + "%";
  $("driveLimit").style.width = (finite(p?.driveFraction) ? 50 * (1 - clamp(p.driveFraction)) : 0) + "%";
  Object.assign($("powerFill").style, {
    width: fill + "%", left: (regen ? 50 - fill : 50) + "%",
    background: regen ? "var(--power-regen)" : "var(--power-active)"
  });
}

const roadCameraElevation = .85;
const roadHistoryStep = .25;
const roadHistorySamples = 144;
let roadHistory = [];
let roadHistoryRemainder = 0;
let roadHistoryDirection;

function updateRoadHistory(direction, curvature, distance) {
  if (roadHistoryDirection !== direction) {
    roadHistory = [];
    roadHistoryRemainder = 0;
    roadHistoryDirection = direction;
  }
  roadHistoryRemainder += distance;
  const samples = Math.floor(roadHistoryRemainder / roadHistoryStep);
  if (samples === 0) return;
  roadHistoryRemainder -= samples * roadHistoryStep;
  roadHistory.unshift(...Array(Math.min(samples, roadHistorySamples)).fill(curvature));
  roadHistory.length = Math.min(roadHistory.length, roadHistorySamples);
}


let ribbonMotion;
function updateRibbonAcceleration(speed, gear) {
  const now = performance.now();
  if (!ribbonMotion || ribbonMotion.gear !== gear || now - ribbonMotion.time > 750 || speed === 0) {
    ribbonMotion = { speed, gear, time: now, acceleration: 0 };
    return 0;
  }
  const elapsed = (now - ribbonMotion.time) / 1000;
  if (elapsed >= .08) {
    const acceleration = Math.max(-8, Math.min(4, (speed - ribbonMotion.speed) / elapsed));
    const blend = 1 - Math.exp(-elapsed / .35);
    ribbonMotion = { speed, gear, time: now, acceleration: ribbonMotion.acceleration + blend * (acceleration - ribbonMotion.acceleration) };
  }
  return ribbonMotion.acceleration;
}

function ribbonLookahead(speed, acceleration) {
  const horizon = acceleration < 0 ? Math.min(1.8, speed / -acceleration) : 1.8;
  return speed * horizon + .5 * acceleration * horizon ** 2;
}

function renderLanePreview(angle, assist, reversing, speedKmh, acceleration = 0) {
  const steering = finite(angle) ? angle : 0;
  const direction = reversing ? -1 : 1;

  // The GPS fit uses fractional vehicle speed. Low-speed yaw measurements
  // add curvature at large steering angles, fading out from 8 to 18 km/h.
  const fitSpeed = Math.max(6.7, Math.min(65.9, speedKmh));
  const fitSteering = Math.max(-450, Math.min(450, finite(angle) ? steering : 1.78));
  const centeredSteering = fitSteering - 1.78;
  const steeringFraction = clamp(Math.abs(centeredSteering) / 380);
  const lowSpeedGain = 1 + .20 * steeringFraction ** 2 * clamp((18 - speedKmh) / 10);
  const curvature = direction * lowSpeedGain * .000497 * centeredSteering / (1 + .0844 * (fitSpeed / 50) ** 2);
  const tightTurn = clamp((Math.abs(steering) - 240) / 210);
  // Let the reverse curve exit toward the footer, even at full lock.
  const maxSweep = (reversing ? 60 : 90 + 70 * tightTurn) * Math.PI / 180;
  const previewDistance = 32;
  const curveEnd = maxSweep / Math.abs(curvature);

  // Build the road in metres on a single plane. The viewing camera is
  // above and behind the car, so only camera depth controls perspective.
  const scene = $("scene");
  const sceneWidth = scene.clientWidth || 600;
  const sceneHeight = scene.clientHeight || 400;
  const aspect = (sceneWidth / 600) / (sceneHeight / 400);
  const nearScale = 36;
  const groundScale = nearScale * aspect * Math.sin(roadCameraElevation);
  const depthGain = .085;
  const viewport = $("cluster").getBoundingClientRect();
  const sceneBounds = scene.getBoundingClientRect();
  const sceneTop = sceneBounds.top;
  const centerY = wideVehicleLayout.matches
    ? (viewport.top + viewport.height / 2 - sceneTop) * 400 / sceneHeight
    : 200;
  const powerBar = $("power").getBoundingClientRect();
  const roadHeight = scene.clientHeight && powerBar.height
    ? Math.max(sceneHeight, powerBar.top - sceneTop)
    : sceneHeight;
  const clipY = roadHeight * 400 / sceneHeight;
  const preview = $("lanePreview");
  // Curved shoulders can swing beyond the center column in either gear.
  // Expand the clip without changing the ground-plane projection.
  const extendSides = scene.clientWidth && viewport.width > sceneWidth;
  const roadWidth = extendSides ? viewport.width : sceneWidth;
  const leftInset = (sceneWidth - roadWidth) / 2;
  preview.setAttribute("viewBox", `${leftInset * 600 / sceneWidth} 0 ${roadWidth * 600 / sceneWidth} ${clipY}`);
  preview.style.width = `${roadWidth}px`;
  preview.style.height = `${roadHeight}px`;
  const nearSpace = clipY - centerY;
  const nearLimit = nearSpace / (groundScale + nearSpace * depthGain);
  const defaultLaneStart = reversing && curvature ? -(nearLimit + 4) / Math.cos(maxSweep) : -nearLimit;
  const laneEnd = previewDistance;

  // Integrate recently traveled ground-plane segments backward from the car.
  // Reproject them relative to the current heading as the car advances.
  let past = [];
  // Keep the displayed trail moving away from the car even if older
  // samples would wrap around into the forward-looking part of the view.
  const historyHeadingLimit = 70 * Math.PI / 180;
  const displayHeading = heading => historyHeadingLimit * Math.tanh(heading / historyHeadingLimit);
  function projectHistory() {
    let rawHeading = -roadHistoryRemainder * curvature;
    let heading = displayHeading(rawHeading);
    let x = -roadHistoryRemainder * Math.sin(heading / 2);
    let z = -roadHistoryRemainder * Math.cos(heading / 2);
    past = [{ x, z, heading }];
    for (const curvature of roadHistory) {
      rawHeading -= roadHistoryStep * curvature;
      const nextHeading = displayHeading(rawHeading);
      const middle = (heading + nextHeading) / 2;
      x -= roadHistoryStep * Math.sin(middle);
      z -= roadHistoryStep * Math.cos(middle);
      heading = nextHeading;
      past.push({ x, z, heading });
    }
  }

  function pastPoint(distance) {
    if (distance < roadHistoryRemainder) {
      const heading = displayHeading(-distance * curvature);
      return { x: -distance * Math.sin(heading / 2), z: -distance * Math.cos(heading / 2), heading };
    }
    const index = (distance - roadHistoryRemainder) / roadHistoryStep;
    const i = Math.min(Math.floor(index), past.length - 1);
    const point = past[i];
    const next = past[i + 1];
    if (!next) {
      const remaining = distance - roadHistoryRemainder - i * roadHistoryStep;
      return { x: point.x - remaining * Math.sin(point.heading),
        z: point.z - remaining * Math.cos(point.heading), heading: point.heading };
    }
    const t = index - i;
    return { x: point.x + (next.x - point.x) * t, z: point.z + (next.z - point.z) * t,
      heading: point.heading + (next.heading - point.heading) * t };
  }

  function projectedRoadPoint(distance, offset) {
    const travel = Math.max(0, direction * distance);
    const curveDistance = Math.min(travel, curveEnd);
    const heading = curveDistance * curvature;
    const exitDistance = Math.max(0, travel - curveEnd);
    const lateral = heading ? (1 - Math.cos(heading)) / curvature + exitDistance * Math.sin(heading) : 0;
    const forward = heading ? direction * (Math.sin(heading) / curvature + exitDistance * Math.cos(heading)) : distance;
    const traveled = direction * distance < 0 && (past.length > 1 || roadHistoryRemainder > 0)
      ? pastPoint(Math.abs(distance)) : null;
    const tangent = traveled?.heading ?? heading;
    const x = direction * (traveled?.x ?? lateral) + offset * Math.cos(tangent);
    const z = (traveled ? direction * traveled.z : forward) - offset * Math.sin(tangent);
    const perspective = 1 / Math.max(.2, 1 + z * depthGain);
    return [300 + x * nearScale * perspective, centerY - z * groundScale * perspective];
  }

  function roadPoint(distance, offset) {
    return projectedRoadPoint(distance, offset).map(value => value.toFixed(2)).join(" ");
  }

  function lanePoints(offset, start, end) {
    const steps = Math.max(2, Math.ceil(Math.abs(end - start) * 4));
    return Array.from({ length: steps + 1 }, (_, i) => roadPoint(start + (end - start) * i / steps, offset));
  }

  function strip(offset, halfWidth, start, end) {
    const left = lanePoints(offset - halfWidth, start, end);
    const right = lanePoints(offset + halfWidth, start, end);
    return "M" + [...left, ...right.reverse()].join(" L") + " Z";
  }

  drawLaneDashes = (phase, traveled = 0) => {
    updateRoadHistory(direction, curvature, traveled);
    projectHistory();
    let laneStart = defaultLaneStart;
    if (!reversing && roadHistory.length) {
      const clipLeft = leftInset * 600 / sceneWidth;
      const clipRight = 600 - clipLeft;
      const shoulderOutside = offset => {
        const [x, y] = projectedRoadPoint(laneStart, offset);
        return y >= clipY || x <= clipLeft || x >= clipRight;
      };
      const historyLimit = -(roadHistorySamples * roadHistoryStep);
      while (laneStart > historyLimit && (!shoulderOutside(-3.855) || !shoulderOutside(3.855))) {
        laneStart -= .5;
      }
    }
    for (const [id, offset] of [["laneShoulderLeft", -3.8], ["laneShoulderRight", 3.8]]) {
      $(id).setAttribute("d", strip(offset, .055, laneStart, laneEnd));
    }
    if (assist === "ap") {
      $("laneLeft").setAttribute("d", strip(-1.65, .065, laneStart, laneEnd));
      $("laneRight").setAttribute("d", strip(1.65, .065, laneStart, laneEnd));
      return;
    }
    const left = [], right = [];
    // Phase is signed by travel in the animation, so a gear change alone preserves it.
    const anchor = -nearLimit - phase;
    const firstDash = anchor + Math.floor((laneStart - anchor) / laneDashPeriod) * laneDashPeriod;
    for (let start = firstDash; start < laneEnd; start += laneDashPeriod) {
      const near = Math.max(laneStart, start);
      const far = Math.min(laneEnd, start + laneDashLength);
      if (far <= near) continue;
      left.push(strip(-1.65, .042, near, far));
      right.push(strip(1.65, .042, near, far));
    }
    $("laneLeft").setAttribute("d", left.join(" "));
    $("laneRight").setAttribute("d", right.join(" "));
  };
  drawLaneDashes(laneDashOffset);

  if (assist !== "fsd" && (assist !== "nav" || reversing)) return;
  const route = $(assist === "fsd" ? "laneRoute" : "navRoute");
  if (assist === "fsd" && speedKmh === 0) {
    route.removeAttribute("d");
    return;
  }
  const carHeight = $("drivingCar").clientHeight || 148;
  const bumperPixels = carHeight * .135 * 400 / sceneHeight;
  const ribbonStart = Math.min(2, bumperPixels / Math.max(1, groundScale - direction * depthGain * bumperPixels));
  const routeDistance = reversing ? nearLimit : laneEnd;
  const routeTip = assist === "fsd"
    ? Math.min(routeDistance, ribbonStart + ribbonLookahead(speedKmh / 3.6, acceleration))
    : routeDistance;
  const halfWidth = assist === "nav" ? .14 : Math.min(.95, carHeight * .13 * 600 / (sceneWidth * nearScale));
  if (assist === "fsd") {
    const fadeStart = routeTip - (routeTip - ribbonStart) * .18;
    const [fadeX, fadeY] = projectedRoadPoint(direction * fadeStart, 0);
    const [leftX, leftY] = projectedRoadPoint(direction * routeTip, -halfWidth);
    const [rightX, rightY] = projectedRoadPoint(direction * routeTip, halfWidth);
    const x2 = (leftX + rightX) / 2, y2 = (leftY + rightY) / 2;
    const capX = rightX - leftX, capY = rightY - leftY;
    const capLength = Math.hypot(capX, capY);
    const normalX = -capY / capLength, normalY = capX / capLength;
    const fadeLength = (x2 - fadeX) * normalX + (y2 - fadeY) * normalY;
    const x1 = x2 - fadeLength * normalX, y1 = y2 - fadeLength * normalY;
    const gradient = $("fsdRouteFill");
    for (const [key, value] of Object.entries({ x1, y1, x2, y2 })) gradient.setAttribute(key, value);
  }
  route.setAttribute("d", strip(0, halfWidth, direction * ribbonStart, direction * routeTip));
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
  const displacement = laneMotionSpeed * elapsed;
  laneDashOffset = (laneDashOffset + displacement) % laneDashPeriod;
  drawLaneDashes?.(laneDashOffset, Math.abs(displacement));
  laneAnimationFrame = requestAnimationFrame(animateLaneDashes);
}

function updateLaneMotion(speed) {
  laneMotionSpeed = speed;
  if (typeof requestAnimationFrame !== "function") return;
  if (speed !== 0 && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
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

const lightingAndSystems = new Set(["parkingLights", "lowBeam", "highBeam", "autoHighBeam",
  "fog", "rearFog", "tpms", "tpmsFault", "coldBattery", "limitedRegen", "airbag"]);
const leftLamps = Object.fromEntries(Object.entries(lamps).filter(([key]) => lightingAndSystems.has(key)));
const rightLamps = Object.fromEntries(Object.entries(lamps).filter(([key]) =>
  !lightingAndSystems.has(key) && key !== "left" && key !== "right" && key !== "hold"));
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const paintColors = {
  0: "#a81a26", 1: "#191b20", 2: "#bfc4cb", 3: "#575d64", 5: "#173669",
  6: "#e4e4e0", 7: "#65182e", 8: "#182c43", 9: "#c4c9ce", 10: "#ba1727",
  11: "#42464b", 13: "#a0bad1", 14: "#8ba7bc", 15: "#22262c", 16: "#b2ab9e",
  17: "#364f64", 20: "#5b819e",
};
const vehiclePicker = $("vehiclePicker");
const vehicleModel = $("vehicleModel");
try {
  const saved = window.NativeCarState?.getAppData?.() ?? window.__DASHPILOT_APP_DATA__ ??
    localStorage.getItem("palladium-vehicle");
  const model = (typeof saved === "string" ? JSON.parse(saved) : saved)?.model;
  if ([...vehicleModel.options].some(option => option.value === model)) vehicleModel.value = model;
} catch {}

let vehicleState;
let vehicleAnchor;
let vehicleTransitionDuration = 950;
let vehicleTransitionTimer;
let vehicleTransitionStart;
const vehicleCluster = $("cluster");
const wideVehicleLayout = matchMedia("(min-width:701px)");
const reducedVehicleMotion = matchMedia("(prefers-reduced-motion: reduce)");
const carCanvas = document.createElement("canvas");
carCanvas.className = "vehicle-canvas";
carCanvas.setAttribute("aria-hidden", "true");
carCanvas.addEventListener("webglcontextlost", () => vehicleCluster.classList.remove("vehicle-ready"));
let vehicleScene;
try {
  vehicleScene = window.createDashPilotCarScene?.(carCanvas, {
    carOnly: true,
    assetRoot: "../web-vanilla-v2/",
    onReady: () => vehicleCluster.classList.add("vehicle-ready"),
  });
} catch {}

function positionVehicle() {
  if (!vehicleAnchor) return;
  const bounds = vehicleAnchor.getBoundingClientRect();
  const viewport = vehicleCluster.getBoundingClientRect();
  const charging = vehicleCluster.classList.contains("charging");
  const centered = !charging && (wideVehicleLayout.matches || vehicleCluster.classList.contains("park-view"));
  const x = centered ? viewport.width / 2 : bounds.left + bounds.width / 2 - viewport.left;
  const y = centered ? viewport.height / 2 : bounds.top + bounds.height / 2 - viewport.top;
  carCanvas.style.left = `${x}px`;
  carCanvas.style.top = `${y}px`;
  carCanvas.style.width = `${bounds.width}px`;
  carCanvas.style.height = `${bounds.height}px`;
}

const vehicleLayoutObserver = new ResizeObserver(positionVehicle);
if (vehicleScene) {
  vehicleCluster.append(carCanvas);
  vehicleLayoutObserver.observe(vehicleCluster);
}

function renderVehicle(s, park, charging, takeover) {
  if (!vehicleScene) return;
  const anchor = $(charging ? "chargingCar" : park ? "parkedCar" : "drivingCar").parentElement;
  const layoutChanged = vehicleAnchor !== anchor || vehicleState?.parked !== (park || charging);
  if (layoutChanged) {
    const leavingPark = vehicleState?.parked && !vehicleState.charging && [2, 4].includes(s.gear);
    vehicleTransitionDuration = leavingPark ? 600 : 950;
    vehicleCluster.style.setProperty("--vehicle-motion-duration", `${vehicleTransitionDuration}ms`);
    const animate = !!vehicleState && !charging && !vehicleState.charging &&
      vehicleCluster.classList.contains("vehicle-ready") && !reducedVehicleMotion.matches;
    clearTimeout(vehicleTransitionTimer);
    vehicleTransitionStart = animate ? performance.now() : undefined;
    vehicleCluster.classList.toggle("vehicle-transitioning", animate);
    if (animate) {
      vehicleTransitionTimer = setTimeout(() => {
        vehicleTransitionStart = undefined;
        // CSS starts on the next layout frame. Let it finish before clearing
        // its transition rules, including after a delayed WebView frame.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (vehicleTransitionStart === undefined) vehicleCluster.classList.remove("vehicle-transitioning");
        }));
      }, vehicleTransitionDuration);
    }
    if (vehicleAnchor !== anchor) {
      if (vehicleAnchor) vehicleLayoutObserver.unobserve(vehicleAnchor);
      vehicleAnchor = anchor;
      vehicleLayoutObserver.observe(anchor);
    }
  }
  carCanvas.hidden = takeover;
  positionVehicle();
  vehicleState = {
    parked: park || charging, charging, driveElevation: roadCameraElevation,
    transitionStart: vehicleTransitionStart, transitionDuration: vehicleTransitionDuration,
    paint: paintColors[s.exteriorColor] ?? paintColors[6],
    model: vehicleModel.value, egoSteeringAngle: s.angle,
    egoSpeed: park || charging ? 0 : s.vehicleSpeedKmh, isImperial: false,
    darkMode: s.darkMode,
  };
  vehicleScene.update(vehicleState);
}

function showVehiclePicker() {
  if (vehiclePicker.open) return;
  if (window.NativeCarState?.setEditing) window.NativeCarState.setEditing(true);
  else window.webkit?.messageHandlers?.editing?.postMessage(true);
  vehiclePicker.showModal();
}
$("parkedCar").addEventListener("click", showVehiclePicker);
vehiclePicker.addEventListener("close", () => {
  if (window.NativeCarState?.setEditing) window.NativeCarState.setEditing(false);
  else window.webkit?.messageHandlers?.editing?.postMessage(false);
});
vehicleModel.addEventListener("change", () => {
  const payload = JSON.stringify({ model: vehicleModel.value });
  try {
    if (window.NativeCarState?.setAppData) window.NativeCarState.setAppData(payload);
    else if (window.webkit?.messageHandlers?.appData) window.webkit.messageHandlers.appData.postMessage(payload);
    else localStorage.setItem("palladium-vehicle", payload);
  } catch {}
  if (vehicleState) {
    carCanvas.classList.remove("ready");
    vehicleState.model = vehicleModel.value;
    vehicleScene?.update(vehicleState);
  }
});

const gearLetters = [..."PRND"];
tags($("gears"), gearLetters.map(gear => [gear]));
let displayedGear = 0, targetGear = 0, gearIsBlue = false, gearTimer;
function paintGear() {
  [...$("gears").children].forEach((letter, i) => {
    letter.classList.toggle("selected", displayedGear === i + 1);
    letter.classList.toggle("auto", displayedGear === i + 1 && gearIsBlue);
  });
}
function updateGear(gear, assisted) {
  const next = gearLetters[gear - 1] ? gear : 0;
  gearIsBlue = assisted;
  if (targetGear !== next) {
    targetGear = next;
    clearTimeout(gearTimer);
    $("gears").setAttribute("aria-label", next ? "Gear " + gearLetters[next - 1] : "Gear unavailable");
    const step = () => {
      if (!displayedGear || !targetGear || matchMedia("(prefers-reduced-motion: reduce)").matches) {
        displayedGear = targetGear;
      } else {
        displayedGear += Math.sign(targetGear - displayedGear);
      }
      paintGear();
      if (displayedGear !== targetGear) gearTimer = setTimeout(step, 72);
    };
    gearTimer = setTimeout(step, displayedGear && targetGear ? 55 : 0);
  }
  paintGear();
}

function render(s) {
  document.body.classList.toggle("night", !!s.darkMode);
  const scene = $("scene");
  const parked = s.gear === 1;
  const reversing = s.gear === 2;
  const navigating = s.assist === "nav";
  const autopilot = s.assist === "ap" || navigating;
  const fsd = s.assist === "fsd";
  const charging = s.charge != null;
  const takeover = s.driverWarning === "takeover";
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
  scene.classList.toggle("reversing", reversing);
  const vehicleSpeedKmh = finite(s.vehicleSpeedKmh) && s.vehicleSpeedKmh >= 0 ? s.vehicleSpeedKmh : 0;
  if (parked || charging || takeover) updateRoadHistory(undefined, 0, 0);
  const acceleration = updateRibbonAcceleration(vehicleSpeedKmh / 3.6, s.gear);
  if (!parked && !charging && !takeover) renderLanePreview(s.angle, s.assist, reversing, vehicleSpeedKmh, acceleration);
  renderVehicle({ ...s, vehicleSpeedKmh }, parked, charging, takeover);
  const moving = !parked && !charging && !takeover;
  updateLaneMotion(moving ? (reversing ? -1 : 1) * vehicleSpeedKmh / 3.6 : 0);
  write("vehicleTitle", parked ? "PARKED VEHICLE" : "DRIVING VIEW");
  write("vehicleStatus", parked ? "" : s.locked === true ? "LOCKED" : s.locked === false ? "UNLOCKED" : "");
  updateGear(s.gear, autopilot || fsd);
  const speed = $("speed");
  const holding = s.lamps?.hold && !parked && !charging;
  if (holding) {
    if (!speed.firstElementChild) {
      const icon = document.createElement("img");
      icon.className = "speed-hold";
      icon.src = "icons/brake-hold.svg";
      icon.alt = "Vehicle Hold";
      speed.replaceChildren(icon);
    }
  } else {
    write("speed", finite(s.speed) ? Math.round(s.speed) : "—");
  }
  write("units", holding ? "HOLD" : s.units);
  write("secondary", !holding && finite(s.speed) && s.mapUnits && s.mapUnits !== s.units
    ? display(speedIn(s.speed, s.units, s.mapUnits), s.mapUnits) : "");
  const autosteerReady = s.assist === "ready";
  $("assist").hidden = parked || (!autopilot && !autosteerReady);
  $("assistValue").parentElement.hidden = !autopilot;
  $("fsdProfile").hidden = parked || !fsd;
  write("fsdProfileValue", fsd ? s.profile ?? "—" : "");
  const wheel = $("wheel");
  wheel.hidden = !autopilot && !autosteerReady;
  wheel.src = autopilot ? "icons/autosteer-active.svg" : "icons/autosteer-ready.svg";
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
  renderPower(charging ? undefined : parked ? { used: 0 } : s.power ?? {});

  $("turnArrows").classList.toggle("signals-flash", !!(s.lamps?.left || s.lamps?.right));
  for (const [key, id] of [["left", "turnArrowLeft"], ["right", "turnArrowRight"]]) {
    const state = s.lamps?.[key];
    $(id).setAttribute("aria-hidden", state ? "false" : "true");
    $(id).classList.toggle("signal-active", !!state);
  }
  const highBeamActive = s.lamps?.highBeam === true || s.lamps?.autoHighBeam === true;
  const visibleLamps = {
    ...s.lamps,
    lowBeam: !highBeamActive && s.lamps?.lowBeam,
    parkingLights: !highBeamActive && !s.lamps?.lowBeam && s.lamps?.parkingLights,
  };
  renderTelltales($("telltalesLeft"), visibleLamps, leftLamps, s.market ?? s.region);
  renderTelltales($("telltalesRight"), s.lamps, rightLamps, s.market ?? s.region);
  const alert = $("alert");
  const alertText = takeover || prompt || parked ? "" : s.alert ?? "";
  if (alert.textContent !== alertText) alert.textContent = alertText;
  const closureSummary = Object.entries(panelNames).flatMap(([key, name]) => {
    const state = s.closures?.[key];
    return ["open", "ajar", "fault", "opening", "closing"].includes(state) ? [name + " " + state] : [];
  }).join(" · ");
  const closureStatus = $("closures");
  closureStatus.hidden = takeover || charging || !closureSummary;
  if (closureStatus.textContent !== closureSummary) closureStatus.textContent = closureSummary;

  if (charging) {
    const c = s.charge;
    const ac = c.kind === "ac";
    $("charge").classList.toggle("charging-ac", ac);
    const remaining = finite(c.minutes) && c.minutes >= 0
      ? (c.minutes < 5 ? c.minutes : Math.round(c.minutes / 5) * 5)
      : undefined;
    const hours = Math.floor(remaining / 60);
    const minutes = remaining % 60;
    const complete = c.minutes === 0;
    $("charge").classList.toggle("charge-complete", complete);
    $("chargeTimeLabel").hidden = complete;
    const formatted = hours ? hours + " h" + (minutes ? " " + minutes + " min" : "") : minutes + " min";
    write("chargeTime", complete ? "Charging Complete" :
      remaining === undefined ? "—" : formatted);
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
    write("chargeBasis", c.basis ?? "");
  }
  const batteryStatus = $("batteryStatus");
  batteryStatus.hidden = s.showCarBattery === false;
  const enoughEnergy = s.enoughEnergyForConvenienceFeatures;
  const lowPower = enoughEnergy === false || enoughEnergy === 0 ||
    (enoughEnergy !== true && enoughEnergy !== 1 && s.soc <= 20);
  batteryStatus.classList.toggle("battery-low", finite(s.soc) && s.soc > 5 && lowPower);
  batteryStatus.classList.toggle("battery-critical", finite(s.soc) && s.soc <= 5);
  $("batteryLevel").style.width = (finite(s.soc) ? clamp(s.soc / 100) * 100 : 0) + "%";
  write("batteryPercent", finite(s.soc) ? Math.round(s.soc) + "%" : "--%");
  write("ambientTemperature", finite(s.outside) ? display(s.outside, s.imperial ? "°F" : "°C") : "");
  write("clock", clockFormat.format(finite(s.currentTime) && s.currentTime > 0 ? s.currentTime : Date.now()));
}

function readCharge(raw) {
  const plugged = raw.chargeType === 1 || raw.chargeType === 2;
  const complete = raw.chargeMinutes === 0 && [0, 1, 2, 4].includes(raw.chargeTransferState);
  if (!plugged || (raw.chargeTransferState !== 5 && !complete)) return undefined;

  const reading = value => finite(value) && value >= 0 ? value : undefined;
  const ac = raw.chargeType === 2;
  return {
    kind: ac ? "ac" : "dc",
    minutes: reading(raw.chargeMinutes),
    kw: reading(ac ? raw.chargeInputKw : raw.batteryInputKw),
    volts: reading(raw.chargeVolts),
    amps: reading(raw.chargeAmps),
    evseAcCurrentLimit: reading(raw.evseAcCurrentLimit),
    numPhases: reading(raw.chargePhases),
  };
}

function liveTelltales(mask) {
  const on = bit => (mask & (1 << bit)) !== 0;
  return {
    parkingLights: on(0), lowBeam: on(1), highBeam: on(2) && !on(3),
    autoHighBeam: on(3) && (on(2) || "standby"), fog: on(4), hold: on(5),
    stability: on(7) || on(9) ? "flash" : on(6) || on(8),
    airbag: on(10), tpms: on(11) && !on(12), tpmsFault: on(12), abs: on(13),
    parkingBrake: on(15) ? "flash" : on(14), rearFog: on(16),
  };
}

function fromDashPilot(raw) {
  const appUnits = raw.isImperial ? "mph" : "km/h";
  const carUnits = raw.distanceUnits === 1 ? "mph" : raw.distanceUnits === 0 ? "km/h" : appUnits;
  const mapUnits = raw.mapSpeedUnits === 1 ? "km/h" : raw.mapSpeedUnits === 0 ? "mph" : undefined;
  const hasSpeed = raw.gear && !(raw.dataSourceType === "dashkit" && raw.uiSpeedUnits === -1);
  const nativeSpeedUnits = raw.egoSpeedUnits ?? (raw.uiSpeedUnits === 1 ? "km/h" : raw.uiSpeedUnits === 0 ? "mph" : carUnits);
  const closureState = value => value == null ? "unknown" : value ? "open" : "closed";
  const autosteerReady = raw.autopilotState === 2 && (raw.fsdEnabled === false || raw.fsdEnabled === 0) && raw.autosteerAvailable !== false;
  const assist = raw.autopilotState === 6 ? "fsd" : raw.autopilotState === 5 ? "nav" :
    [3, 4].includes(raw.autopilotState) ? "ap" :
    autosteerReady ? "ready" : undefined;
  const profiles = ["Chill", "Standard", "Hurry", "Mad Max", "Sloth"];
  return {
    gear: raw.gear, vehicleSpeedKmh: raw.vehicleSpeedKmh, speed: hasSpeed ? speedIn(raw.egoSpeed, nativeSpeedUnits, carUnits) : undefined,
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
      left: raw.leftBlinker == null ? raw.telltales?.left : raw.leftBlinker === 2 || raw.leftBlinker === 1,
      right: raw.rightBlinker == null ? raw.telltales?.right : raw.rightBlinker === 2 || raw.rightBlinker === 1,
      door: !!raw.anyDoorOpen, belt: raw.buckleStatus === 0 },
    alert: raw.driverAlert ?? (raw.changingLane ? "Changing lane" :
      raw.speedCameraDistance > 0 ? "Speed camera · " + raw.speedCameraDistance + " m" : ""),
    imperial: raw.isImperial, currentTime: raw.currentTime,
    darkMode: [0, 1, false, true].includes(raw.displayInDarkMode) ? !!raw.displayInDarkMode : raw.darkMode,
    exteriorColor: raw.exteriorColor,
    enoughEnergyForConvenienceFeatures: raw.enoughEnergyForConvenienceFeatures ?? raw.BMS_enoughEnergyForConvenienceFe,
    outside: raw.ambientTempC > -100 ? (raw.isImperial ? raw.ambientTempC * 1.8 + 32 : raw.ambientTempC) : undefined,
    showCarBattery: raw.showCarBattery,
    soc: raw.showCarBattery !== false && finite(raw.soc) && raw.soc >= 0 && raw.soc <= 100 ? raw.soc : undefined,
  };
}

const nativeKeys = [
  "egoSpeed", "vehicleSpeedKmh", "gear", "egoSteeringAngle", "leftBlinker", "rightBlinker", "accSetSpeed", "fusedSpeedLimit",
  "anyDoorOpen", "doorOpenFL", "doorOpenFR", "doorOpenRL", "doorOpenRR", "trunkOpen", "trunkPosition",
  "frunkOpen", "buckleStatus", "isImperial", "showCarBattery", "nominalEnergyRemaining", "energyBuffer",
  "fullPackEnergy", "powerLevel", "currentTime",
  "speedCameraDistance", "changingLane", "dataSourceType", "distanceUnits", "mapSpeedUnits", "mapRegion",
  "mapLimit", "market", "fsdEnabled", "autosteerAvailable", "autopilotState", "autopilotAborting", "autopilotHandsOnState", "handsOnReason", "attentionBasedDriverMonitorOn", "drivingProfile", "ambientTempC", "darkMode", "displayInDarkMode", "exteriorColor", "enoughEnergyForConvenienceFeatures",
  "uiSpeedUnits", "soc", "chargeTransferState", "chargeType", "chargeMinutes", "chargeVolts", "chargeAmps", "chargeInputKw", "evseAcCurrentLimit", "chargePhases", "batteryInputKw", "telltaleBits"
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
    gear: parked ? 1 : mode === "reverse" ? 2 : mode === "neutral" ? 3 : 4, assist: mode, profile: $("demoFsdProfile").value, angle: Number($("steering").value),
    units, mapUnits: region === "us" ? "mph" : "km/h", region,
    vehicleSpeedKmh: parked ? 0 : Number($("demoSpeed").value),
    speed: parked ? 0 : speedIn(Number($("demoSpeed").value), "km/h", units),
    setSpeed: speedIn(113, "km/h", units), limit: region === "us" ? 65 : 100,
    power: parked ? { used: 0 } : { used: mode === "fsd" ? -.34 : .42, driveFraction: .79, regenFraction: .73 },
    lamps: activeLamps, closures, plugged, locked: parked && mode !== "park", liftgateAngle: 68,
    windows: mode === "park" ? { frontLeft: 35 } : undefined,
    driverWarning: parked ? undefined : $("demoAlert").value,
    driverWarningEscalated: $("demoAlertEscalated").checked,
    charge: plugged ? { kind: dc ? "dc" : "ac", rangeRateMiles: dc ? 410 : 13, volts: dc ? 392 : 240,
      amps: dc ? 310 : 16, evseAcCurrentLimit: dc ? undefined : 32, kw: dc ? 121.5 : 3.84,
      minutes: dc ? 14 : 95 } : undefined,
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

#pragma once

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <string>

#include "car/car_state_mapper.h"

// Assembles CarState::vin from VIN_info (0x405) on the vehicle bus. The VIN
// arrives as three muxed segments in any order; each is read as unscaled bits
// because the 56-bit VIN signals are wider than double's 53-bit mantissa, so
// the normal cp.get() path would silently corrupt the top byte(s).
class TeslaVinUpdater {
public:
    void update(const CANParsers& cp, CarState& cs) {
        if (seen_ == kAllSegments) return;
        for (size_t i = 0; i < kSegments.size(); i++) {
            if (seen_ & (1u << i)) continue;
            const Segment& seg = kSegments[i];

            uint64_t raw;
            if (!cp.getRaw(1, "VIN_info", seg.signal, &raw)) continue;

            char chars[7];
            for (int b = 0; b < 7; b++) chars[b] = static_cast<char>(raw >> (8 * b));

            bool valid = true;
            for (int b = 0; b < seg.textStart; b++) valid &= chars[b] == '\0';
            for (int b = seg.textStart; b < 7; b++) valid &= isVinChar(chars[b]);
            if (!valid) continue;

            std::memcpy(pending_ + seg.vinOffset, chars + seg.textStart, 7 - seg.textStart);
            seen_ |= 1u << i;
        }
        if (seen_ == kAllSegments) {
            std::memcpy(cs.vin, pending_, CarState::VIN_LENGTH);
        }
    }

private:
    struct Segment {
        const char* signal;
        int textStart;   // first payload byte; earlier bytes must be zero
        int vinOffset;
    };

    static constexpr std::array<Segment, 3> kSegments{{
        {"VIN_A405", 4, 0},
        {"VIN_B405", 0, 3},
        {"VIN_C405", 0, 10},
    }};
    static constexpr uint8_t kAllSegments = 0b111;

    // ISO 3779: digits and letters except I, O, Q.
    static bool isVinChar(char c) {
        if (c >= '0' && c <= '9') return true;
        if (c >= 'A' && c <= 'Z') return c != 'I' && c != 'O' && c != 'Q';
        return false;
    }

    uint8_t seen_ = 0;
    char pending_[CarState::VIN_LENGTH] = {};
};

static inline double readVehicleSpeedKmh(const CANParsers& cp, int bus) {
    uint64_t bits = 0;
    if (!cp.getRaw(bus, "DI_speed", "DI_vehicleSpeed", &bits, 3)) return -1;
    return std::abs(static_cast<double>(bits) - 500.0) * 0.08;
}

static inline void updatePartyBus(const CANParsers& cp, CarState& cs) {
    cs.egoSteeringAngle = cp.get(2, "SCCM_steeringAngleSensor", "SCCM_steeringAngle");
    cs.gear = cp.get(2, "DI_systemStatus", "DI_gear");
    cs.egoSpeed = cp.get(2, "DI_speed", "DI_uiSpeed");
    cs.vehicleSpeedKmh = readVehicleSpeedKmh(cp, 2);
    cs.adasOn = cp.get(2, "DI_state", "DI_cruiseState") == 2.0 ? 1.0 : 0.0;
    cs.leftBlindSpot = cp.get(2, "DAS_status", "DAS_blindSpotRearLeft");
    cs.rightBlindSpot = cp.get(2, "DAS_status", "DAS_blindSpotRearRight");
    cs.fusedSpeedLimit = cp.get(2, "DAS_status", "DAS_fusedSpeedLimit");
    cs.trafficLightColor = cp.get(2, "DAS_road", "DAS_trafficLightColor");
    cs.stopLineDist = cp.get(2, "DAS_road", "DAS_stopLineDist");
    cs.leftBlinker = cp.get(2, "UI_warning", "leftBlinkerBlinking");
    cs.rightBlinker = cp.get(2, "UI_warning", "rightBlinkerBlinking");
    cs.anyDoorOpen = cp.get(2, "UI_warning", "anyDoorOpen");
    cs.buckleStatus = cp.get(2, "UI_warning", "buckleStatus");
    cs.accSetSpeed = cp.get(2, "DI_state", "DI_digitalSpeed");
}

static inline double powerLevel(const CarState& cs) {
    if (cs.packVoltage <= 0 || cs.maxDischargePower <= 0 || cs.maxRegenPower <= 0) return 0;
    double kw = cs.packVoltage * cs.packCurrent / 1000.0;
    double limit = kw >= 0 ? cs.maxDischargePower : cs.maxRegenPower;
    return std::clamp(kw / limit, -1.0, 1.0) * 100.0;
}

// VCLEFT/VCRIGHT_*LatchStatus: 0 SNA, 1 OPENED, 2 CLOSED, 3 CLOSING, 4 OPENING,
// 5 AJAR, 6 TIMEOUT, 7 DEFAULT, 8 FAULT. Open until the latch reports closed;
// unknown/fault states read as closed so a stale bus doesn't light a warning.
static inline double latchOpen(double latchStatus) {
    int s = static_cast<int>(latchStatus);
    return (s == 1 || s == 3 || s == 4 || s == 5) ? 1.0 : 0.0;
}

// Per-door, trunk and frunk latch state plus the powered-liftgate angle, from
// the vehicle bus (DashKit forwards 0x102, 0x103, 0x142 and 0x2E1).
static inline void updateClosures(const CANParsers& cp, CarState& cs) {
    cs.doorOpenFL = latchOpen(cp.get(1, "VCLEFT_doorStatus", "VCLEFT_frontLatchStatus"));
    cs.doorOpenRL = latchOpen(cp.get(1, "VCLEFT_doorStatus", "VCLEFT_rearLatchStatus"));
    cs.doorOpenFR = latchOpen(cp.get(1, "VCRIGHT_doorStatus", "VCRIGHT_frontLatchStatus"));
    cs.doorOpenRR = latchOpen(cp.get(1, "VCRIGHT_doorStatus", "VCRIGHT_rearLatchStatus"));
    cs.trunkOpen = latchOpen(cp.get(1, "VCRIGHT_doorStatus", "VCRIGHT_trunkLatchStatus"));
    // VCLEFT_liftgateStatus is multiplexed: the angle lives on mux 1. Keep the
    // last angle across mux-0 frames. Closed reads slightly negative on some cars.
    if (static_cast<int>(cp.get(1, "VCLEFT_liftgateStatus", "VCLEFT_liftgateStatusIndex")) == 1) {
        cs.trunkPosition = std::max(0.0, cp.get(1, "VCLEFT_liftgateStatus", "VCLEFT_liftgatePosition"));
    }
    // VCFRONT_status is multiplexed: the frunk latch lives on mux 0.
    if (static_cast<int>(cp.get(1, "VCFRONT_status", "VCFRONT_statusIndex")) == 0) {
        cs.frunkOpen = latchOpen(cp.get(1, "VCFRONT_status", "VCFRONT_frunkLatchStatus"));
    }
}

static inline void updateInstrumentCluster(const CANParsers& cp, CarState& cs) {
    uint64_t bits = 0;
    const auto read = [&](int bus, const char* message, const char* signal, size_t length) {
        return cp.getRaw(bus, message, signal, &bits, length);
    };

    if (read(0, "DAS_status", "DAS_autopilotState", 1)) cs.autopilotState = bits;
    if (read(0, "DAS_status", "DAS_autopilotHandsOnState", 6)) cs.autopilotHandsOnState = bits;
    if (read(0, "DAS_warningMatrix0", "DAS_w042_autopilotAborting", 6)) cs.autopilotAborting = bits;
    if (read(0, "DAS_carLog", "DAS_LC_handsOnReason", 4)) cs.handsOnReason = bits;
    if (cs.autopilotHandsOnState < 3) cs.handsOnReason = -1;

    if (read(0, "UI_autopilotControl", "UI_enableFullSelfDriving", 6) ||
        read(1, "UI_autopilotControl", "UI_enableFullSelfDriving", 6)) cs.fsdEnabled = bits;
    const auto profile = [&](int bus) {
        return read(bus, "UI_autopilotControl", "UI_autopilotDrivingProfile", 8) && bits <= 4;
    };
    if (profile(1) || profile(0)) cs.drivingProfile = bits;
    const auto readSpeed = [&](int bus) {
        if (!read(bus, "DI_speed", "DI_uiSpeed", 5) || bits == 255) return false;
        const auto speed = bits;
        if (!read(bus, "DI_speed", "DI_uiSpeedUnits", 5)) return false;
        cs.egoSpeed = speed;
        cs.uiSpeedUnits = bits;
        return true;
    };
    cs.uiSpeedUnits = -1;
    if (!readSpeed(0)) readSpeed(1);
    cs.vehicleSpeedKmh = readVehicleSpeedKmh(cp, 0);
    if (cs.vehicleSpeedKmh < 0) cs.vehicleSpeedKmh = readVehicleSpeedKmh(cp, 1);
    if (!read(0, "DI_systemStatus", "DI_gear", 3) &&
        read(1, "DI_systemStatus", "DI_gear", 3)) cs.gear = bits;
    if (read(1, "UI_chassisControl", "UI_distanceUnits", 3) ||
        read(0, "UI_chassisControl", "UI_distanceUnits", 3)) cs.distanceUnits = bits;
    if (read(1, "GTW_carConfig", "GTW_mapRegion", 2)) cs.mapRegion = bits;

    const auto map = [&](int bus, const char* message) {
        if (!read(bus, message, "UI_mapSpeedLimitUnits", 7)) return false;
        cs.mapSpeedUnits = bits;
        if (read(bus, message, "UI_mppSpeedLimit", 7)) cs.mapLimit = bits < 31 ? bits * 5.0 : -1;
        return true;
    };
    if (!map(1, "UI_gpsVehicleSpeed") && !map(0, "UI_gpsVehicleSpeedCH")) {
        map(0, "UI_gpsVehicleSpeed");
    }

    cs.soc = read(1, "UI_range", "UI_uSoe", 5) && bits <= 100 ? static_cast<double>(bits) : -1;
    if (read(1, "VCFRONT_sensors", "VCFRONT_tempAmbientFiltered", 6)) {
        cs.ambientTempC = bits > 0 && bits <= 240 ? bits * 0.5 - 40 : -1000;
    }

    if (read(1, "CP_chargeStatus", "CP_powerTransferStatus", 1) ||
        read(1, "CP_chargeStatus", "CP_hvChargeStatus", 1)) cs.chargeTransferState = bits;
    if (read(1, "CP_chargeStatus", "CP_evseChargeType", 6) && cs.chargeType != bits) {
        cs.chargeType = bits;
        cs.chargeMeterKwh = -1;
    }
    if (read(1, "BMS_kwhCountersMultiplexed", "BMS_acChargerKwhTotal", 5) && cs.chargeType == 2) {
        cs.chargeMeterKwh = bits == 0xFFFFFFFFu ? -1 : bits * 0.001;
    }
    if (read(1, "BMS_kwhCountersMultiplexed", "BMS_dcChargerKwhTotal", 5) && cs.chargeType == 1) {
        cs.chargeMeterKwh = bits == 0xFFFFFFFFu ? -1 : bits * 0.001;
    }
    if (read(1, "CP_chargeStatus", "CP_evseAcCurrentLimit", 2) ||
        read(1, "CP_chargeStatus", "CP_acChargeCurrentLimit", 2)) cs.evseAcCurrentLimit = bits * 0.5;
    if (read(1, "CC_chgStatus", "CC_numPhases", 2)) cs.chargePhases = bits;
    if (read(1, "PCS_chgLineStatus", "PCS_chgInputVoltage", 2)) cs.chargeVolts = bits * 0.033;
    if (read(1, "PCS_chgLineStatus", "PCS_chgLineCurrent", 3)) cs.chargeAmps = bits * 0.1;
    if (read(1, "PCS_chgLineStatus", "PCS_chgInputPower", 4)) cs.chargeInputKw = bits * 0.1;
    if (read(1, "BMS_status", "BMS_batteryInputPower", 4)) cs.batteryInputKw = bits == 65535 ? -1 : bits * 0.05;
    const auto chargeEta = [&](int bus) {
        return read(bus, "UI_powerEstimates", "UI_chargeTimeUntilTerminationPct", 4) && bits <= 1440;
    };
    cs.chargeMinutes = (chargeEta(1) || chargeEta(0)) ? static_cast<double>(bits) : -1;
    if (read(1, "UI_range", "UI_ratedRange", 2)) cs.ratedRangeMiles = bits;

    const auto lamp = [&](int bus, const char* message, const char* signal,
                          size_t length, uint64_t expected, unsigned position) {
        return read(bus, message, signal, length) && bits == expected ? 1u << position : 0u;
    };
    unsigned telltales = 0;
    if (read(1, "VCFRONT_lightingTalas", "VCFRONT_lightingCoreState", 8)) {
        if (bits == 1 || bits == 3) telltales |= 1u << 0;
        if (bits == 4) telltales |= 1u << 1;
    }
    telltales |= lamp(1, "VCFRONT_lightingTalas", "VCFRONT_latchedHighBeamsFunction", 8, 1, 2);
    telltales |= lamp(1, "VCFRONT_lightingTalas", "VCFRONT_intHighBeamsFunctionStat", 8, 1, 2);
    telltales |= lamp(1, "VCFRONT_lightingTalas", "VCFRONT_highBeamControlState", 8, 3, 3);
    telltales |= lamp(1, "VCFRONT_lightStatus", "VCFRONT_fogLeftStatus", 8, 1, 4);
    telltales |= lamp(1, "VCFRONT_lightStatus", "VCFRONT_fogRightStatus", 8, 1, 4);
    telltales |= lamp(1, "DI_chassisControlStatus", "DI_vehicleHoldTelltaleOn", 3, 1, 5);
    telltales |= lamp(1, "DI_chassisControlStatus", "DI_vdcTelltaleOn", 3, 1, 6);
    telltales |= lamp(1, "DI_chassisControlStatus", "DI_vdcTelltaleFlash", 3, 1, 7);
    telltales |= lamp(1, "DI_chassisControlStatus", "DI_tcTelltaleOn", 3, 1, 8);
    telltales |= lamp(1, "DI_chassisControlStatus", "DI_tcTelltaleFlash", 3, 1, 9);
    telltales |= lamp(0, "RCM_status", "RCM_warningIndicatorState", 2, 1, 10);
    telltales |= lamp(0, "TPMS_StatusC", "TPMS_c_globalHardWarning", 1, 1, 11);
    telltales |= lamp(0, "TPMS_StatusC", "TPMS_systemMalfunction", 1, 1, 12);
    telltales |= lamp(0, "ESP_alertMatrix", "ESP_a102_absFault", 6, 1, 13);
    if (read(1, "EPBR_status", "EPBR_telltale", 8)) {
        if (bits == 1 || bits == 2) telltales |= 1u << 14;
        if (bits == 4) telltales |= 1u << 15;
    }
    telltales |= lamp(1, "VCRIGHT_lightStatus", "VCRIGHT_rearFogLightStatus", 2, 1, 16);
    cs.telltaleBits = telltales;
}

static inline void updateVehicleBus(const CANParsers& cp, CarState& cs) {
    updateInstrumentCluster(cp, cs);
    uint64_t displayMode = 0;
    if (cp.getRaw(1, "UI_status2", "UI_displayInDarkMode", &displayMode, 3) ||
        cp.getRaw(0, "UI_status2", "UI_displayInDarkMode", &displayMode, 3)) {
        cs.displayInDarkMode = displayMode;
    }
    uint64_t exteriorColor = 0;
    if (cp.getRaw(1, "GTW_carConfig", "GTW_exteriorColor", &exteriorColor, 7)) {
        cs.exteriorColor = exteriorColor;
    }

    uint64_t convenienceEnergy = 0;
    if (cp.getRaw(1, "BMS_socStatus", "BMS_enoughEnergyForConvenienceFe", &convenienceEnergy, 6)) {
        cs.enoughEnergyForConvenienceFeatures = convenienceEnergy;
    }

    // Vehicle bus specific signals
    // BMS_energyStatus is multiplexed: mux 0 has pack/remaining energy, mux 1 has energyBuffer
    int muxIdx = static_cast<int>(cp.get(1, "BMS_energyStatus", "BMS_energyStatusIndex"));
    if (muxIdx == 0) {
        cs.fullPackEnergy = cp.get(1, "BMS_energyStatus", "BMS_nominalFullPackEnergy");
        cs.nominalEnergyRemaining = cp.get(1, "BMS_energyStatus", "BMS_nominalEnergyRemaining");
    } else if (muxIdx == 1) {
        cs.energyBuffer = cp.get(1, "BMS_energyStatus", "BMS_energyBuffer");
    }
    cs.maxRegenPower = cp.get(1, "BMS_powerAvailable", "BMS_maxRegenPower");
    cs.maxDischargePower = cp.get(1, "BMS_powerAvailable", "BMS_maxDischargePower");
    cs.packVoltage = cp.get(1, "BMS_hvBusStatus", "BMS_packVoltage");
    cs.packCurrent = cp.get(1, "BMS_hvBusStatus", "BMS_packCurrent");
    cs.powerLevel = powerLevel(cs);
    // BMS_bmbMinMax is multiplexed: mux 0 (THERM) carries the thermistor min/max
    // temps. Only update on that mux so other muxes don't zero out the last reading.
    if (static_cast<int>(cp.get(1, "BMS_bmbMinMax", "BMS_bmbMinMaxMultiplexer")) == 0) {
        cs.packTMin = cp.get(1, "BMS_bmbMinMax", "BMS_thermistorTMin");
        cs.packTMax = cp.get(1, "BMS_bmbMinMax", "BMS_thermistorTMax");
    }
    cs.odometer = cp.get(1, "DI_odometerStatus", "DI_odometer");

    constexpr auto ambient = "UI_ambientLightingCtrls";
    uint64_t brightness = 0;
    if (cp.getRaw(1, ambient, "UI_ambientLightingBrightness", &brightness, 7)) {
        const auto red = static_cast<uint32_t>(cp.get(1, ambient, "UI_ambientLightingRed"));
        const auto green = static_cast<uint32_t>(cp.get(1, ambient, "UI_ambientLightingGreen"));
        const auto blue = static_cast<uint32_t>(cp.get(1, ambient, "UI_ambientLightingBlue"));
        cs.ambientLightingColor = (red << 16) | (green << 8) | blue;
        cs.ambientLightingBrightness = brightness;
        cs.ambientLightingAvailable = 1;
    }
}


// Turns the lamp-only turn-signal status (0=OFF, 1=ON, 2=FAULT, 3=SNA) into
// the party-bus tri-state (0=off, 1=blinking/lamp off, 2=blinking/lamp on).
struct BlinkerHold {
    static constexpr std::chrono::milliseconds HOLD{1000};

    std::chrono::steady_clock::time_point lastOn{};
    bool seenOn = false;

    double update(double rawStatus) {
        bool lampOn = static_cast<int>(rawStatus) == 1;  // 1=ON
        auto now = std::chrono::steady_clock::now();
        if (lampOn) {
            lastOn = now;
            seenOn = true;
        }
        bool blinking = seenOn && (now - lastOn) <= HOLD;
        if (!blinking) return 0.0;
        return lampOn ? 2.0 : 1.0;
    }
};

static inline void updateTurnSignals(const CANParsers& cp, CarState& cs,
                                     BlinkerHold& leftHold, BlinkerHold& rightHold) {
    // The front controller's simulated latching stalk selects the side.
    // Use the requests for blink phase and preserve both arrows for hazards.
    for (const auto* message : {"VCFRONT_lightingTalas", "VCFRONT_lighting", "VCFRONT_lightingLegacy"}) {
        uint64_t left = 0, right = 0;
        if (cp.getRaw(1, message, "VCFRONT_indicatorLeftRequest", &left, 8) &&
            cp.getRaw(1, message, "VCFRONT_indicatorRightRequest", &right, 8)) {
            uint64_t latch = 3, hazards = 0;
            const bool hasLatch = cp.getRaw(1, message, "VCFRONT_turnIndicatorStalk", &latch, 8) ||
                                  cp.getRaw(1, message, "VCFRONT_simLatchingStalk", &latch, 8);
            const bool hazardActive = cp.getRaw(1, message, "VCFRONT_hazardLightRequest", &hazards, 8) &&
                                      hazards > 0 && hazards <= 8;
            if (hazardActive) {
                cs.leftBlinker = left == 2 ? 2 : 1;
                cs.rightBlinker = right == 2 ? 2 : 1;
            } else if (hasLatch && latch <= 2) {
                cs.leftBlinker = latch == 1 ? (left == 2 ? 2 : 1) : 0;
                cs.rightBlinker = latch == 2 ? (right == 2 ? 2 : 1) : 0;
            } else {
                cs.leftBlinker = left <= 2 ? left : 0;
                cs.rightBlinker = right <= 2 ? right : 0;
            }
            return;
        }
    }

    cs.leftBlinker = leftHold.update(cp.get(1, "VCLEFT_lightStatus", "VCLEFT_turnSignalStatus"));
    cs.rightBlinker = rightHold.update(cp.get(1, "VCRIGHT_lightStatus", "VCRIGHT_turnSignalStatus"));
}

class TeslaCommaPartyMapper : public CarStateMapper {
public:
    void update(const CANParsers& cp, CarState& cs) override {
        updatePartyBus(cp, cs);
    }
};

class TeslaDashKitMapper : public CarStateMapper {
public:
    void update(const CANParsers &cp, CarState &cs) override {
        cs.egoSteeringAngle = cp.get(0, "SCCM_steeringAngleSensor", "SCCM_steeringAngle");
        cs.gear = cp.get(0, "DI_systemStatus", "DI_gear");
        cs.egoSpeed = cp.get(0, "DI_speed", "DI_uiSpeed");
        cs.adasOn = cp.get(0, "DAS_status2", "DAS_lssState") >= 2.0 ? 1.0 : 0.0;

        // TODO: Invalid in case of DashKit. Look for an equivalent.
        cs.accSetSpeed = cp.get(0, "DI_state", "DI_digitalSpeed");

        cs.leftBlindSpot = cp.get(0, "DAS_status", "DAS_blindSpotRearLeft");
        cs.rightBlindSpot = cp.get(0, "DAS_status", "DAS_blindSpotRearRight");
        cs.fusedSpeedLimit = cp.get(0, "DAS_status", "DAS_fusedSpeedLimit");
        cs.trafficLightColor = cp.get(0, "DAS_road", "DAS_trafficLightColor");
        cs.stopLineDist = cp.get(0, "DAS_road", "DAS_stopLineDist");

        updateTurnSignals(cp, cs, leftBlinkerHold_, rightBlinkerHold_);


        // VCFRONT_status is multiplexed: VCFRONT_anyDoorOpen lives on mux 0
        if (static_cast<int>(cp.get(1, "VCFRONT_status", "VCFRONT_statusIndex")) == 0) {
            cs.anyDoorOpen = cp.get(1, "VCFRONT_status", "VCFRONT_anyDoorOpen");
        }

        // VCLEFT_switchStatus is multiplexed: VCLEFT_frontBuckleSwitch lives on mux 0
        if (static_cast<int>(cp.get(1, "VCLEFT_switchStatus", "VCLEFT_switchStatusIndex")) == 0) {
            cs.buckleStatus = cp.get(1, "VCLEFT_switchStatus", "VCLEFT_frontBuckleSwitch") == 2.0 ? 1.0 : 0.0;
        }

        updateClosures(cp, cs);

        // Climate setpoint temperature (degC) from the vehicle bus.
        cs.acTemp = cp.get(1, "UI_hvacRequest", "UI_hvacReqTempSetpointLeft");
        cs.acTempRight = cp.get(1, "UI_hvacRequest", "UI_hvacReqTempSetpointRight");
        cs.hvacFanLevel = cp.get(1, "UI_hvacRequest", "UI_hvacReqBlowerSegment");
        cs.hvacPowerState = cp.get(1, "UI_hvacRequest", "UI_hvacReqUserPowerState");
        cs.hvacAcMode = cp.get(1, "UI_hvacRequest", "UI_hvacReqACDisable");
        cs.hvacRecirc = cp.get(1, "UI_hvacRequest", "UI_hvacReqRecirc");
        cs.hvacKeepClimateOn = cp.get(1, "UI_hvacRequest", "UI_hvacReqKeepClimateOn");

        updateVehicleBus(cp, cs);
        vin_.update(cp, cs);
        // TPMS: pressures come from mux 5 (all four wheels, 0.025 bar resolution);
        // temperatures and sensor battery voltages from muxes 0-3 (one sensor each). Their per-sensor pressure is
        // coarser (0.05 bar) and would alternate with mux 5, so it is not used.
        // Fields keep their last value until a frame carries that wheel again.
        // getRaw fails until a frame has been seen; get() would read 0 and look like mux 0.
        uint64_t tpmsIndex = 0;
        if (cp.getRaw(1, "VCSEC_TPMSData", "VCSEC_TPMSDataIndex", &tpmsIndex)) {
            if (tpmsIndex == 5) {
                double* pressures[4] = {&cs.tpmsPressureFL, &cs.tpmsPressureFR, &cs.tpmsPressureRL, &cs.tpmsPressureRR};
                static const char* const kP[4] = {"FL", "FR", "RL", "RR"};
                for (int w = 0; w < 4; w++) {
                    double v = cp.get(1, "VCSEC_TPMSData", std::string("VCSEC_TPMSPressure") + kP[w]);
                    if (v >= 0.5 && v < 6.36) *pressures[w] = v;
                }
            } else if (tpmsIndex <= 3) {
                // Mux 0 RR, 1 RL, 2 FR, 3 FL (verified against mux 5 in CAN logs).
                double* tempOfMux[4] = {&cs.tpmsTempRR, &cs.tpmsTempRL, &cs.tpmsTempFR, &cs.tpmsTempFL};
                double t = cp.get(1, "VCSEC_TPMSData", "VCSEC_TPMSTemperature" + std::to_string(tpmsIndex));
                if (t < 214.5) *tempOfMux[tpmsIndex] = t;
                double* battOfMux[4] = {&cs.tpmsBattRR, &cs.tpmsBattRL, &cs.tpmsBattFR, &cs.tpmsBattFL};
                double v = cp.get(1, "VCSEC_TPMSData", "VCSEC_TPMSBatVoltage" + std::to_string(tpmsIndex));
                if (v < 4.045) *battOfMux[tpmsIndex] = v;  // raw 0xFF (4.05 V) = not available
            }
        }
    }

private:
    BlinkerHold leftBlinkerHold_;
    BlinkerHold rightBlinkerHold_;
    TeslaVinUpdater vin_;
};

// New-gen Model Y (Juniper) with new_gen_juniper.dbc on both buses. Comma and
// DashKit number the buses the same way here: 0 = chassis, 1 = vehicle.
class TeslaJuniperMapper : public CarStateMapper {
public:
    void update(const CANParsers &cp, CarState &cs) override {
        cs.egoSteeringAngle = cp.get(1, "SCCM_steeringAngleSensor", "SCCM_steeringAngle");
        cs.gear = cp.get(0, "DI_systemStatus", "DI_gear");
        cs.egoSpeed = cp.get(0, "DI_speed", "DI_uiSpeed");
        cs.adasOn = cp.get(1, "DI_state", "DI_cruiseState") == 2.0 ? 1.0 : 0.0;
        cs.accSetSpeed = cp.get(1, "DI_state", "DI_digitalSpeed");

        cs.leftBlindSpot = cp.get(0, "DAS_status", "DAS_blindSpotRearLeft");
        cs.rightBlindSpot = cp.get(0, "DAS_status", "DAS_blindSpotRearRight");
        cs.fusedSpeedLimit = cp.get(0, "DAS_status", "DAS_fusedSpeedLimit");
        // DAS_road is static on Juniper: no traffic light or stop line data.

        updateTurnSignals(cp, cs, leftBlinkerHold_, rightBlinkerHold_);

        if (static_cast<int>(cp.get(1, "VCFRONT_status", "VCFRONT_statusIndex")) == 0) {
            cs.anyDoorOpen = cp.get(1, "VCFRONT_status", "VCFRONT_anyDoorOpen");
        }
        if (static_cast<int>(cp.get(1, "VCLEFT_switchStatus", "VCLEFT_switchStatusIndex")) == 0) {
            cs.buckleStatus = cp.get(1, "VCLEFT_switchStatus", "VCLEFT_frontBuckleSwitch") == 2.0 ? 1.0 : 0.0;
        }

        cs.acTemp = cp.get(0, "UI_hvacRequest", "UI_hvacReqTempSetpointLeft");
        cs.acTempRight = cp.get(0, "UI_hvacRequest", "UI_hvacReqTempSetpointRight");
        cs.hvacFanLevel = cp.get(0, "UI_hvacRequest", "UI_hvacReqBlowerSegment");
        cs.hvacPowerState = cp.get(0, "UI_hvacRequest", "UI_hvacReqUserPowerState");
        cs.hvacAcMode = cp.get(0, "UI_hvacRequest", "UI_hvacReqACDisable");
        cs.hvacRecirc = cp.get(0, "UI_hvacRequest", "UI_hvacReqRecirc");
        cs.hvacKeepClimateOn = cp.get(0, "UI_hvacRequest", "UI_hvacReqKeepClimateOn");

        updateClosures(cp, cs);
        updateVehicleBus(cp, cs);
        vin_.update(cp, cs);
    }

private:
    BlinkerHold leftBlinkerHold_;
    BlinkerHold rightBlinkerHold_;
    TeslaVinUpdater vin_;
};

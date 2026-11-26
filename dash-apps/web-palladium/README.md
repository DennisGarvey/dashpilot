# Palladium CAN inputs

DashPilot decodes the signals and supplies them to Palladium. CH and VEH identify the chassis and vehicle CAN buses. Signal availability depends on which frames the vehicle broadcasts on the buses DashKit can read.

## Driving and display

- **Speed and gear.** DashKit reads `DI_uiSpeed` and `DI_uiSpeedUnits` (0x257) for the speedometer, `DI_vehicleSpeed` (0x257) for the road visualization, and `DI_gear` (0x118) for PRND. `UI_distanceUnits` (0x293) selects the large speedometer unit. An alternate speed reading appears in map units when they differ.
- **Steering and lane visualization.** `SCCM_steeringAngle` (0x129) steers the lane preview and rotates the active Autosteer icon. Speed controls the motion of the lane markings. The preview geometry is generated in Palladium.
- **Posted speed limit.** `UI_mppSpeedLimit` and `UI_mapSpeedLimitUnits` (CH 0x2F8, VEH 0x373) provide the map number and unit. `DAS_fusedSpeedLimit` (0x399 CH) is the fallback. `GTW_mapRegion` (0x7FF VEH, mux 3) selects the European or North American sign family. A live Canadian override needs a verified country mapping, for example from `GTW_country` (mux 1).
- **Autopilot and FSD.** `DAS_autopilotState` (0x399 CH) distinguishes available, active Autosteer, Navigate on Autopilot, active FSD, and aborting. `UI_enableFullSelfDriving` (0x3FD, mux 0) indicates the selected FSD setting, and `UI_autopilotDrivingProfile` (mux 2) gives the profile name. DashKit reads the cruise set speed from `DI_digitalSpeed` (0x286) on supported vehicles. `DAS_accSpeedLimit` describes a map-derived ACC limit.
- **Driver warnings.** `DAS_autopilotHandsOnState` (0x399 CH) gives the visual or escalated alert level. `DAS_LC_handsOnReason` (0x5D9 CH, mux 2) distinguishes supported steering and attention prompts. `DAS_w042_autopilotAborting` (0x32A CH) also triggers the takeover display.
- **Battery and power.** DashKit uses `UI_uSoe` (0x33A) for the displayed percentage on supported vehicles. `BMS_enoughEnergyForConvenienceFe` (0x292) provides the convenience-energy flag. `BMS_packVoltage` and `BMS_packCurrent` (0x132 VEH) give the power estimate. `BMS_maxDischargePower` and `BMS_maxRegenPower` (0x252 VEH) give the current limits. The striped unavailable fraction requires nominal power references for the vehicle. The snowflake still needs an identified OEM display trigger.
- **Appearance and temperature.** `GTW_exteriorColor` (0x7FF VEH, mux 2) selects the car paint. `UI_displayInDarkMode` (0x3DF VEH) selects the theme with the app theme as a fallback. `VCFRONT_tempAmbientFiltered` (0x321 VEH) provides ambient temperature. Temperature units and the clock come from the app.

## Body and warning indicators

- **Turn signals and hazards.** `VCFRONT_indicatorLeftRequest` and `VCFRONT_indicatorRightRequest` (0x3F5 or 0x3F1 VEH) supply turn-signal activity. Palladium animates the arrows with 360 ms bright and 360 ms dim. The simulated latching stalk (`VCFRONT_turnIndicatorStalk` or `VCFRONT_simLatchingStalk`) selects the side, and `VCFRONT_hazardLightRequest` enables both arrows. The side controllers’ lamp statuses (0x3E2 and 0x3E3 VEH) are a fallback when neither front-controller frame is available.
- **Closures and restraints.** `VCLEFT_frontLatchStatus` and `VCLEFT_rearLatchStatus` (0x102 VEH), `VCRIGHT_frontLatchStatus`, `VCRIGHT_rearLatchStatus`, and `VCRIGHT_trunkLatchStatus` (0x103 VEH), `VCFRONT_frunkLatchStatus` and `VCFRONT_anyDoorOpen` (0x2E1 VEH, mux 0), `VCLEFT_liftgatePosition` (0x142 VEH, mux 1), and `VCLEFT_frontBuckleSwitch` (0x3C2 VEH, mux 0). The live closure overlay uses open/closed state. Detailed latch states, vehicle locking (`VCSEC_vehicleLockStatus`), and charge-port door position (`CP_chargeDoorOpenUI`, 0x25D VEH) need separate app mapping.
- **Lighting and chassis telltales.** On bus 1, `VCFRONT_lightingCoreState` (0x3F5) selects parking lights or low beams. The same frame provides the momentary, latched, and automatic high-beam states. The front fog telltale uses the left and right lamp statuses in `VCFRONT_lightStatus` (0x3F6) on bus 1. `DI_vehicleHoldTelltaleOn`, `DI_vdcTelltaleOn/Flash`, and `DI_tcTelltaleOn/Flash` (0x2B6 VEH) cover Hold, stability, and traction. `RCM_warningIndicatorState` (0x211 CH), `TPMS_c_globalHardWarning` and `TPMS_systemMalfunction` (0x36F CH), and `ESP_a102_absFault` (0x3D5 CH, mux 1) cover airbag, tire, and ABS warnings. Parking-brake and brake-system variants, stability-off, reduced power, cold battery, and limited-regeneration icons still need live mappings.

## Charging

- **Charge mode and connection.** `CP_powerTransferStatus` and `CP_evseChargeType` (0x13D VEH) drive the AC/DC charging screen.
- **AC.** `PCS_chgInputVoltage`, `PCS_chgLineCurrent`, and `PCS_chgInputPower` (0x264 VEH), `CP_evseAcCurrentLimit` (0x13D VEH), and `CC_numPhases` (0x31C VEH).
- **DC.** `BMS_batteryInputPower` (0x212 VEH). The DC screen shows kW and omits voltage and current.
- **Time remaining.** `UI_chargeTimeUntilTerminationPct` (0x33B) gives minutes until the charge target. DashPilot requests it on both DashKit buses and prefers a valid vehicle-bus reading.

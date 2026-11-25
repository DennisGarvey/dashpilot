package com.softwiredtech.dashpilot.vehicle

import com.softwiredtech.dashpilot.datamodel.dash.CarState
import com.softwiredtech.dashpilot.datasource.RawCanFrame
import com.softwiredtech.dashpilot.jni.VehicleBridge

// This is a wrapper for the C++ VehicleDecoder so that DataSources that are
// non-native (such as PandaBleDataSource) can still decode can frames.
class CanFrameDecoder(
    private val bridge: VehicleBridge,
    profile: VehicleProfile
) {
    var decoderHandle: Long = bridge.nativeCreateVehicleDecoder(
        profile.dbcContents, profile.busIndices, profile.type
    )

    // Decodes one BLE packet's frames in a single JNI call: one result array and
    // one CarState per packet instead of per frame.
    @Synchronized fun decodeFrames(frames: List<RawCanFrame>): CarState? {
        if (decoderHandle == 0L) return null
        val buses = IntArray(frames.size)
        val addresses = IntArray(frames.size)
        val lengths = IntArray(frames.size)
        val data = ByteArray(frames.sumOf { it.data.size })
        var offset = 0
        frames.forEachIndexed { i, f ->
            buses[i] = f.bus
            addresses[i] = f.address
            lengths[i] = f.data.size
            f.data.copyInto(data, offset)
            offset += f.data.size
        }
        val values = bridge.nativeDecodeCanFrames(decoderHandle, buses, addresses, lengths, data)
        return arrayToCarState(values)
    }

    /** The CAN ids this vehicle's mapper reads, in the DashKit CAN filter wire
     * format; empty when there is nothing to subscribe to. */
    @Synchronized fun canFilterPayload(): ByteArray {
        if (decoderHandle == 0L) return ByteArray(0)
        return bridge.nativeCanFilterPayload(decoderHandle)
    }

    @Synchronized fun destroy() {
        bridge.nativeDestroyVehicleDecoder(decoderHandle)
        decoderHandle = 0
    }

    companion object {
        fun arrayToCarState(values: DoubleArray): CarState {
            return CarState(
                egoSteeringAngle = values[0].toFloat(),
                egoSpeed = values[1].toFloat(),
                leftBlinker = values[2].toFloat(),
                rightBlinker = values[3].toFloat(),
                gear = values[4].toFloat(),
                adasOn = values[5] > 0,
                leftBlindSpot = values[6].toFloat(),
                rightBlindSpot = values[7].toFloat(),
                fusedSpeedLimit = values[8].toFloat(),
                stopLineDist = values[9].toFloat(),
                trafficLightColor = values[10].toFloat(),
                anyDoorOpen = values[11].toFloat(),
                buckleStatus = values[12].toFloat(),
                accSetSpeed = values[13].toFloat(),
                // Vehicle bus
                fullPackEnergy = values[14].toFloat(),
                nominalEnergyRemaining = values[15].toFloat(),
                energyBuffer = values[16].toFloat(),
                maxRegenPower = values[17].toFloat(),
                maxDischargePower = values[18].toFloat(),
                packVoltage = values[19].toFloat(),
                packCurrent = values[20].toFloat(),
                packTMin = values[21].toFloat(),
                packTMax = values[22].toFloat(),
                odometer = values[23].toFloat(),
                //Openpilot
                selfdriveActive = values[24] > 0,
                experimentalMode = values[25] > 0,
                madsActive = values[26] > 0,
                changingLane = values[27] > 0,
                acTemp = values[28].toFloat(),
                acTempRight = values[29].toFloat(),
                hvacFanLevel = values[30].toFloat(),
                hvacPowerState = values[31].toFloat(),
                hvacAcMode = values[32].toFloat(),
                hvacRecirc = values[33].toFloat(),
                hvacKeepClimateOn = values[34].toFloat(),
                powerLevel = values[35].toFloat(),
                vin = decodeVin(values, offset = 36),
                // TPMS after VIN (see CarState::TPMS_OFFSET): pressures, temperatures, sensor batteries; FL FR RL RR each.
                tpmsPressureFL = values[39].toFloat(),
                tpmsPressureFR = values[40].toFloat(),
                tpmsPressureRL = values[41].toFloat(),
                tpmsPressureRR = values[42].toFloat(),
                tpmsTempFL = values[43].toFloat(),
                tpmsTempFR = values[44].toFloat(),
                tpmsTempRL = values[45].toFloat(),
                tpmsTempRR = values[46].toFloat(),
                tpmsBattFL = values[47].toFloat(),
                tpmsBattFR = values[48].toFloat(),
                tpmsBattRL = values[49].toFloat(),
                tpmsBattRR = values[50].toFloat(),
                // Closures after TPMS (see CarState::DOOR_OFFSET): doors FL FR RL RR, trunk open, trunk angle, frunk open.
                doorOpenFL = values[51].toFloat(),
                doorOpenFR = values[52].toFloat(),
                doorOpenRL = values[53].toFloat(),
                doorOpenRR = values[54].toFloat(),
                trunkOpen = values[55].toFloat(),
                trunkPosition = values[56].toFloat(),
                frunkOpen = values[57].toFloat(),
                ambientLightingAvailable = values[58] > 0,
                ambientLightingColor = values[59].toInt(),
                ambientLightingBrightness = values[60].toFloat(),
                displayInDarkMode = values.getOrNull(61)?.toInt() ?: -1,
                exteriorColor = values.getOrNull(62)?.toInt() ?: -1,
                enoughEnergyForConvenienceFeatures = values.getOrNull(63)?.toInt() ?: -1,
                autopilotState = values.getOrNull(64) ?: -1.0,
                autopilotHandsOnState = values.getOrNull(65) ?: -1.0,
                autopilotAborting = values.getOrNull(66) ?: -1.0,
                handsOnReason = values.getOrNull(67) ?: -1.0,
                fsdEnabled = values.getOrNull(68) ?: -1.0,
                drivingProfile = values.getOrNull(69) ?: -1.0,
                distanceUnits = values.getOrNull(70) ?: -1.0,
                uiSpeedUnits = values.getOrNull(71) ?: -1.0,
                mapSpeedUnits = values.getOrNull(72) ?: -1.0,
                mapRegion = values.getOrNull(73) ?: -1.0,
                mapLimit = values.getOrNull(74) ?: -1.0,
                soc = values.getOrNull(75) ?: -1.0,
                ambientTempC = values.getOrNull(76) ?: -1000.0,
                chargeTransferState = values.getOrNull(77) ?: -1.0,
                chargeType = values.getOrNull(78) ?: -1.0,
                chargeMinutes = values.getOrNull(79) ?: -1.0,
                ratedRangeMiles = values.getOrNull(80) ?: -1.0,
                chargeVolts = values.getOrNull(81) ?: -1.0,
                chargeAmps = values.getOrNull(82) ?: -1.0,
                chargeInputKw = values.getOrNull(83) ?: -1.0,
                evseAcCurrentLimit = values.getOrNull(84) ?: -1.0,
                chargePhases = values.getOrNull(85) ?: -1.0,
                batteryInputKw = values.getOrNull(86) ?: -1.0,
                chargeMeterKwh = values.getOrNull(87) ?: -1.0,
                telltaleBits = values.getOrNull(88) ?: 0.0,
            )
        }

        // VIN chars arrive bit-cast into doubles, 8 ASCII bytes per double,
        // little-endian; see CarState::toArray in bridge/car/car_state.h.
        private fun decodeVin(values: DoubleArray, offset: Int): String {
            val bytes = ByteArray(VIN_DOUBLE_COUNT * 8)
            for (chunk in 0 until VIN_DOUBLE_COUNT) {
                val bits = values[offset + chunk].toRawBits()
                for (b in 0 until 8) {
                    bytes[chunk * 8 + b] = (bits ushr (8 * b)).toByte()
                }
            }
            val length = bytes.indexOf(0).let { if (it < 0) bytes.size else it }
            return String(bytes, 0, length, Charsets.US_ASCII)
        }

        private const val VIN_DOUBLE_COUNT = 3
    }
}

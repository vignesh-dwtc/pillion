package expo.modules.intercom.logic

object BatteryMath {
  /** 0..100, or null when the platform gave no usable reading (level < 0, scale <= 0). */
  fun percent(level: Int, scale: Int): Int? {
    if (level < 0 || scale <= 0) return null
    return Math.round(level * 100f / scale).coerceIn(0, 100)
  }

  /** BatteryManager.BATTERY_STATUS_CHARGING = 2, BATTERY_STATUS_FULL = 5. */
  fun isCharging(status: Int): Boolean = status == 2 || status == 5
}

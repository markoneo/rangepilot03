package expo.modules.rangepilotcar

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/**
 * Range Pilot on the car screen (Android Auto): the range dial with battery and
 * consumption, and chargers nearby with the battery % on arrival.
 */
class RangePilotCarService : CarAppService() {
  override fun createHostValidator(): HostValidator {
    // Nothing private is shown (public charger data and the user's own battery level).
    return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
  }

  override fun onCreateSession(): Session {
    return RangePilotSession()
  }
}

class RangePilotSession : Session() {
  override fun onCreateScreen(intent: Intent): Screen {
    return RangeScreen(carContext)
  }
}

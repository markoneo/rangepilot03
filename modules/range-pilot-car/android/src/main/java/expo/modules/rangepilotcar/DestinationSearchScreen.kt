package expo.modules.rangepilotcar

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.Row
import androidx.car.app.model.SearchTemplate
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * "Can I make it?" — where to. Speak or type an address, or tap a place used
 * before on the phone. Picking one opens the answer (DestinationResultScreen).
 */
class DestinationSearchScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
  private val main = Handler(Looper.getMainLooper())
  private val io: ExecutorService = Executors.newSingleThreadExecutor()
  private val token = UUID.randomUUID().toString()
  private var query = ""
  private var searchId = 0
  private var loading = false
  private var results: List<Suggestion> = emptyList()
  private var destroyed = false
  private val runSearch = Runnable { search() }

  init {
    lifecycle.addObserver(this)
  }

  override fun onDestroy(owner: LifecycleOwner) {
    destroyed = true
    main.removeCallbacks(runSearch)
    io.shutdownNow()
  }

  private fun onText(text: String, now: Boolean) {
    query = text.trim()
    main.removeCallbacks(runSearch)
    if (query.length < 2) {
      searchId++
      loading = false
      results = emptyList()
      invalidate()
      return
    }
    // wait for a pause in the typing
    main.postDelayed(runSearch, if (now) 0L else 450L)
  }

  private fun search() {
    if (destroyed) return
    val id = ++searchId
    val q = query
    val state = CarStore.read(carContext)
    loading = true
    invalidate()
    try {
      io.execute {
        val found = try {
          CarMaps.search(q, state?.lat, state?.lon, token, state)
        } catch (e: Exception) {
          emptyList<Suggestion>()
        }
        main.post {
          if (!destroyed && id == searchId) {
            results = found
            loading = false
            invalidate()
          }
        }
      }
    } catch (e: Exception) {
      loading = false
      invalidate()
    }
  }

  private fun pick(s: Suggestion) {
    if (destroyed) return
    val lat = s.lat
    val lon = s.lon
    if (lat != null && lon != null) {
      open(CarPlace(s.title, s.subtitle, lat, lon))
      return
    }
    val state = CarStore.read(carContext)
    val id = ++searchId
    loading = true
    invalidate()
    try {
      io.execute {
        val place = try {
          CarMaps.resolve(s, token, state)
        } catch (e: Exception) {
          null
        }
        main.post {
          if (!destroyed && id == searchId) {
            loading = false
            if (place != null) {
              open(place)
            } else {
              CarToast.makeText(carContext, "Could not find that place", CarToast.LENGTH_LONG).show()
              invalidate()
            }
          }
        }
      }
    } catch (e: Exception) {
      loading = false
      invalidate()
    }
  }

  private fun open(place: CarPlace) {
    screenManager.push(DestinationResultScreen(carContext, place))
  }

  private fun limit(): Int {
    return try {
      if (carContext.carAppApiLevel >= 2) {
        carContext.getCarService(ConstraintManager::class.java)
          .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST)
          .coerceIn(1, 12)
      } else {
        6
      }
    } catch (e: Exception) {
      6
    }
  }

  override fun onGetTemplate(): Template {
    val callback = object : SearchTemplate.SearchCallback {
      override fun onSearchTextChanged(searchText: String) {
        onText(searchText, false)
      }

      override fun onSearchSubmitted(searchText: String) {
        onText(searchText, true)
      }
    }
    val builder = SearchTemplate.Builder(callback)
      .setHeaderAction(Action.BACK)
      .setSearchHint("Where to?")
      .setShowKeyboardByDefault(false)

    if (loading) {
      builder.setLoading(true)
      return builder.build()
    }

    val items = ItemList.Builder()
    val max = limit()
    if (query.length < 2) {
      // nothing typed yet: the places used before on the phone
      val recents = CarStore.read(carContext)?.recents ?: emptyList()
      if (recents.isEmpty()) {
        items.setNoItemsMessage("Say or type where you are going.")
      } else {
        for (place in recents.take(max)) {
          val row = Row.Builder().setTitle(place.name).setOnClickListener { open(place) }
          if (place.address.isNotEmpty()) row.addText(place.address)
          items.addItem(row.build())
        }
      }
    } else if (results.isEmpty()) {
      items.setNoItemsMessage("Nothing found. Try another name or address.")
    } else {
      for (s in results.take(max)) {
        val row = Row.Builder().setTitle(s.title).setOnClickListener { pick(s) }
        if (s.subtitle.isNotEmpty()) row.addText(s.subtitle)
        items.addItem(row.build())
      }
    }
    builder.setItemList(items.build())
    return builder.build()
  }
}

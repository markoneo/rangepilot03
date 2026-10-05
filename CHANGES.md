# Range Pilot — update (Oct 2026)

## Range / distance fixes (tunnels + background)

Root causes found in the old code and what replaced them:

| Problem | Effect | Fix |
|---|---|---|
| On phones, storage was an in-memory object (AsyncStorage was installed but unused) | If the OS killed the app in the background, the active drive **and guest trip history** were lost | `utils/kv.ts` — AsyncStorage on native, localStorage on web |
| Background location task was defined inside a React effect | OS deliveries after suspend / kill were dropped | Task is registered at app start (`index.js` → `utils/tripTracker.ts`) |
| Distance segments > 100 m were discarded | Any 3 s GPS gap at highway speed lost distance (under-count) | Segments validated by implied speed (≤ 250 km/h) instead |
| Gap detection used the time JS received the fix, not the GPS timestamp | Background batches looked like outages → dead-reckoning added on top of real fixes (double count) | All logic uses fix timestamps; batches sorted and deduplicated |
| On return from background: last speed × time away | Park for 2 h after driving at 80 km/h → +160 km | Gap = distance from last GPS position to the next one, refined to **road distance** (Google key if set, otherwise free OSRM fallback in the edge function) |
| Poor network positions in tunnels counted as "GPS OK" (with speed 0) | Android: tunnel mode never engaged, distance froze | Fixes with accuracy > 50 m are ignored and don't count as signal |
| Tunnel estimate written into the trip, then road distance added | Over-count after every tunnel | During an outage the estimate is **display-only**; it's replaced by the measured gap when GPS returns |
| Parked GPS jitter | Slowly creeping km while standing | Anchor-based jitter filter |

The engine is now in `utils/trackCore.ts` (pure logic, simulated against highway, tunnel,
background-gap, parking, jitter and duplicate-stream scenarios) and `utils/tripTracker.ts`
(state, persistence, GPS, background). It runs outside React, so the drive keeps going even
if you leave the drive screen.

**Note for the web/PWA version:** browsers stop GPS when the app is in the background — no
code can change that. The app now shows a hint and reconstructs the missed km from the road
distance when you come back. Full background tracking needs the native build (EAS / dev
build; Expo Go on iOS does not support background location).

## Simpler to use
- Start drive goes straight into the drive (no second setup screen asking the same things).
- Drive screen leads with **range left**; battery and consumption are simple − / + rows
  (tap the number to type it), reserve is one tap (Off / 5 / 10 / 15 / 20 %).
- **Learns your real consumption**: correct the battery % to what the car shows (after 5 km)
  and the consumption + range update automatically. Detects charging stops.
- Finish sheet: confirm end battery, save, or discard.
- "Drive in progress" banner on home; the drive survives app restarts and resumes GPS on launch.
- Presets fixed (City 15.5 / Mixed 18 / Highway 21 — highway was lower than city before)
  plus "My avg" from your recent trips.
- One dark theme across the app; status bar fixed (was dark text on dark screens).

## Statistics
- New per trip: moving time, average moving speed, top speed, climb/descent, range left at end,
  cost, km reconstructed across GPS gaps.
- Statistics screen: 7 / 30 / 90 days / all, distance chart, charging cost and cost per 100 km,
  distance-weighted averages, temperature / speed / trip-length comparisons. Works from the first trip.
- Settings: electricity price + currency, default reserve.

## Other fixes
- Package versions aligned with Expo SDK 54 (`expo-location`, `expo-task-manager` were SDK 55,
  `expo-keep-awake` and `expo-image-picker` were used but missing).
- Statistics / trip pages opened right after launch no longer show empty (user ID race).
- Cloud sync no longer silently fails when columns differ.

## To deploy
1. `npm install`
2. Run the new migration `supabase/migrations/20261005120000_add_trip_stats_json.sql`
   (optional — trips still sync without it, just without the new stats).
3. Redeploy the edge function `tunnel-distance` (adds the free OSRM road-distance fallback).
4. Build a new native app (`eas build`) — `app.json` background settings were already correct;
   the entry point is now `index.js`.

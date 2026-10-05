/*
  # Extra per-trip statistics

  Adds a single `stats` jsonb column to `user_trips` holding:
    movingSeconds, elevationGainM, elevationLossM, estimatedKm (km reconstructed
    across GPS gaps), gpsGaps, reservePercent, rangeAtEndKm, pricePerKwh, currency.

  The app retries without `stats` if this migration hasn't been applied yet, so
  trips keep syncing either way — but run it to keep the new statistics in the
  cloud.
*/

ALTER TABLE user_trips ADD COLUMN IF NOT EXISTS stats jsonb;

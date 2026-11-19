---
name: sea-level-at-place
description: Sea-level trend at one or more named places over a period (e.g. "past 10 years at Duck and Boston").
---
Steps:
1. For each place: geocode(place) -> find_stations(lat, lon, radius_miles=50).
   Pick the first (nearest) station. If the list is empty, report
   nearest_outside_radius and stop for that place.
2. compute_trend(station_id, start_year, end_year) for each gauge.
   If it returns an error, try the next nearest station (max 3 tries).
3. get_long_term_trend(station_id) for each gauge.
4. If more than one place, or the user wants a plot:
   plot_sea_level(station_ids=[...], start_year, end_year).
5. Answer: one line per place: place -> gauge name (id, distance mi):
   short-window trend ± CI; long-term trend ± CI (record years).
   Add one sentence noting that short windows are noisy.

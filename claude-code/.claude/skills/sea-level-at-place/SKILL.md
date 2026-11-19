---
name: sea-level-at-place
description: How sea level is changing at one or more named places (cities, beaches, NOAA gauges) over a period, e.g. "past 10 years at Duck and Boston" or "Wilmington since 1990". Finds the nearest tide gauge, fetches data, computes the trend, and plots when useful.
---
# Sea level at a place

1. For each place, call `geocode`. If the user named a NOAA gauge, use it directly.
2. Call `find_stations` with radius 50 miles (or the user's radius).
   - Pick the nearest gauge. Report its name, NOAA id, and distance in miles.
   - If the nearest has too little data (step 3), try the next nearest, up to 3.
   - If no gauge is in range, stop for that place: say so and give the
     `nearest_outside_radius` gauge and distance. Offer to use it.
3. Call `compute_trend` for the period (default: past 10 years = 2016–2025).
   Skip a gauge with under 80% of months and say why.
4. If more than one place, or the user cares about change over time, call
   `plot_sea_level` once with all gauges (max 4) and give the file path.
5. For context, call `get_long_term_trend` for each gauge.
6. Answer, in this order:
   - one line per place: place → gauge (id, distance): short-window trend ± CI;
     long-term trend ± CI and record years;
   - one or two sentences on what stands out;
   - the caveat about short windows if the period is under ~20 years.

---
name: sea-level-trend
description: Sea-level trend and plot for named places or gauges over a period, e.g. "past 10 years at Duck and Boston" or "Norfolk since 2000".
---
# Sea-level trend for places

1. Resolve each place with `geocode`.
2. Call `stations_within_radius` with a 50-mile radius unless the user asks for
   another distance.
   - Use the nearest gauge. If it has no usable data, try the next nearest
     (at most 3).
   - If no gauge is within range, say so and name the nearest gauge with its
     distance instead of guessing.
3. Call `get_sea_level_trend` for each chosen gauge and the requested years.
   Exclude a gauge with under 80% of months, and say so.
4. If the question is about change over time or compares places, call
   `plot_stations` once with all gauges (max 4). For a single quick number,
   a plot is optional.
5. Answer: one line per place (place → gauge, NOAA id, distance, trend with
   95% CI). Then one caveat: windows shorter than about 20 years are dominated
   by year-to-year variability, and NOAA's long-term trend (`get_long_term_trend`)
   is the better guide for planning.

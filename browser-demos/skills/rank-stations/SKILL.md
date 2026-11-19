---
name: rank-stations
description: Rank all tide gauges in a state by sea-level trend, e.g. "which NC station rises fastest" or "highest and lowest in Florida".
---
# Rank the gauges in a state

1. Call `list_stations_in_state` with the two-letter state code.
2. Call `get_sea_level_trend` for every gauge over the requested years.
   Exclude gauges with under 80% of months and list them as excluded.
3. Sort by trend. Choose the gauges that answer the question:
   - "highest" / "fastest" → top N (default 1 for "which station", 3 for "which stations")
   - "lowest" / "slowest" → bottom N
   - "highest and lowest" → one from each end, unless a number is given
4. Call `plot_stations` with only the answer gauges if a chart helps or the
   user asked for one.
5. Answer: the answer gauges with NOAA id and trend ± CI, then the full
   ranking from highest to lowest in one line.
6. Caveat: if the confidence intervals of the answer gauges overlap with the
   next ones, say the ranking is not statistically robust.

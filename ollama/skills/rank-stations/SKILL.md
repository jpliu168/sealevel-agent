---
name: rank-stations
description: Rank the tide gauges in a US state by sea-level trend (e.g. "which NC gauge rises fastest", "highest and lowest in Florida").
---
Steps:
1. list_stations(state) with the two-letter code (NC, VA, FL...).
2. compute_trend(station_id, start_year, end_year) for EVERY station in the
   list. Skip stations that return an error and say they were skipped.
3. Sort by trend_mm_per_yr. "Which station" = 1 answer; "highest and lowest"
   = one from each end; "top N" = N.
4. plot_sea_level with only the answer stations (max 4).
5. Answer: the answer stations (id, trend ± CI), then the full ranking from
   highest to lowest. If confidence intervals overlap, say the ranking is
   not statistically robust.

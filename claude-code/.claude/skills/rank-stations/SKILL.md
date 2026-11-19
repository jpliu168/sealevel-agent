---
name: rank-stations
description: Rank all tide gauges in a state by sea-level trend, e.g. "which NC gauge is rising fastest", "highest and lowest in Florida", "top 3 in Virginia since 2000".
---
# Rank the gauges in a state

1. `list_stations` with the two-letter state code.
2. `compute_trend` for every gauge over the requested period (default 2016–2025).
   Exclude gauges with under 80% of months; list them as excluded with the reason.
3. Sort by trend and pick the answer:
   - "which station" → 1; "which stations" with no number → 3; "top N" → N
   - "highest and lowest" → one from each end unless a number is given
4. `plot_sea_level` with only the answer gauges (max 4).
5. Answer with the answer gauges (id, trend ± CI), then the full ranking from
   highest to lowest in a compact table.
6. If the answer gauges' confidence intervals overlap with the next ones, say
   the ranking is not statistically robust. Optionally add each gauge's
   `get_long_term_trend` for contrast.

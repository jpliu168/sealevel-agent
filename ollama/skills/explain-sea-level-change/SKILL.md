---
name: explain-sea-level-change
description: Explain WHY sea level at a gauge rises fast, slowly, or differently from another place or from its long-term record.
---
Steps:
1. Use the gauges and period from the conversation. If unknown, ask.
2. get_long_term_trend(station_id) for each gauge.
3. compute_trend for a longer window (1996 to 2025) to see if the short
   window depends on the years chosen.
4. Explain with the causes that fit the place:
   - land subsidence (groundwater/oil-gas pumping, sediment compaction):
     Houston-Galveston, Mississippi delta, Chesapeake Bay, Norfolk
   - glacial isostatic adjustment: adds ~1-2 mm/yr in the mid-Atlantic;
     uplift lowers sea level in Alaska
   - ocean currents (Gulf Stream, Loop Current), winds, El Nino
   - an unusually high or low first or last year tilts short trends
5. Quote the numbers you got. Label general knowledge as such.

---
name: explain-sea-level-change
description: Explain WHY a gauge's trend is high, low, flat, or different from another gauge or from its long-term record. Use for "why", "how come", "what causes" questions and follow-ups.
---
# Explain sea-level change

1. Recall the gauges and period from the conversation. If none are known,
   ask which place, or run the sea-level-trend skill first.
2. Put the short window in context:
   - Call `get_long_term_trend` for each gauge involved.
   - If the window is short, call `get_sea_level_trend` for a longer window
     (e.g. the past 20 or 30 years) to test whether the result depends on the
     chosen years.
3. Go through the likely causes and keep the ones that fit this place:
   - Land subsidence: groundwater, oil and gas withdrawal, sediment compaction
     (Houston–Galveston, Mississippi delta, Chesapeake Bay).
   - Glacial isostatic adjustment: forebulge collapse adds about 1–2 mm/yr in
     the mid-Atlantic; land uplift lowers relative sea level in Alaska.
   - Tectonic uplift (Pacific Northwest, Alaska).
   - Ocean dynamics: Gulf Stream and AMOC changes (Northeast hotspot), the
     2010s Southeast and Gulf "hotspot", Loop Current.
   - Year-to-year variability: El Niño, NAO, persistent winds, storms, river
     discharge.
   - Window endpoints: an unusually high or low first or last year can tilt
     a short trend.
4. Answer: lead with the two or three causes best supported by the numbers,
   quote the numbers (short-window vs long-term trend), mark the rest as
   possible contributors, and suggest one dataset that could test the
   explanation (e.g. GPS vertical land motion, satellite altimetry).

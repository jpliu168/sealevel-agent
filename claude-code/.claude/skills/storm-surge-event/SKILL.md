---
name: storm-surge-event
description: Analyze a storm, hurricane, nor'easter, or flooding event at a place on specific dates — peak water level, storm surge (observed minus predicted tide), and timing.
---
# Storm surge event

1. Resolve the place to the nearest gauge (`geocode`, `find_stations`, 50 mi).
2. Determine the dates. If the user names a storm without dates, use your
   general knowledge of landfall dates, state that you did so, and pad the
   window by 2 days on each side (max 31 days).
3. `get_water_levels` for the window. It returns the peak observed level
   (meters above MLLW), the peak surge, and a CSV path.
4. Plot observed vs predicted water level and the surge from the CSV with a
   short script in `outputs/scripts/` (Python with matplotlib if available,
   otherwise write an SVG). Save the figure in `outputs/`.
5. Answer: peak water level and time (convert GMT to local time), peak
   surge and time, whether the peak coincided with high tide, and the file
   paths. Note that MLLW-based levels are not the same as flood depth on land.

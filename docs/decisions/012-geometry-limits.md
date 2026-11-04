# 012 Geometry limits

Date: 2026-11-04 · Status: accepted

Drawn polygons are limited to 20 corners in the UI. The API accepts up to 64 vertices per ring because a circle is stored as a 48-corner polygon. Every geometry must lie within a bounding box covering mainland Norway, Svalbard and Jan Mayen, must not self-intersect (checked in code and with PostGIS `ST_IsValid`), and areas are capped by `MAX_AREA_KM2`.

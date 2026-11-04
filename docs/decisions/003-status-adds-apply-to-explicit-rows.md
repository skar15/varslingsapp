# 003 Status `adds` also apply on top of explicit situation rows

Date: 2026-11-04 · Status: accepted

The filtering rule says "explicit rows, or if none, type defaults plus status adds minus removes". Acceptance test A2 has an explicit `wind` row and expects precipitation to be monitored "because the status added it". Implemented: status `adds` are added on top of explicit rows too, `removes` remove from either set, and a situation the status added has effective sensitivity HIGH. See `packages/shared/src/monitoring.ts`.

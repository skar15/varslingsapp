# 010 Erasure scope

Date: 2026-11-04 · Status: accepted — legal review pending (D9)

The daily erasure job removes names, emails, phone numbers, object nicknames, place labels, geometries, county numbers, device tokens, invitations and proposals for deleted accounts, and clears audit metadata. It keeps ids, notification rows (no personal fields) and `municipality_no` as anonymised counts for area-based suggestions (spec, later phases). A deletion request cancels the Stripe subscription immediately.

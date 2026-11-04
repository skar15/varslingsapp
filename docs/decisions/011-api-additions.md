# 011 Endpoints added to the API table

Date: 2026-11-04 · Status: accepted

| Endpoint | Why |
| --- | --- |
| `GET /v1/plans` | The landing page shows the plans. |
| `POST /v1/billing/portal-session`, `POST /v1/billing/change-plan` | Account screen; see 005. |
| `POST /v1/account/deletion-request` | Owner-only deletion request (also required in-app by App Store guideline 5.1.1(v)). |
| `POST /v1/me/phone/refresh` | See 009. |
| `POST /v1/me/test-notification` | "Test notification" button. |
| `DELETE /v1/users/invitations/{id}` | Revoke a pending invitation (pending invitations count toward the limit). |
| `POST /v1/webhooks/sms` | Twilio delivery reports. |
| `GET /v1/objects/{id}/forecast` | Exists but returns `501 not_available_until_m6`. |

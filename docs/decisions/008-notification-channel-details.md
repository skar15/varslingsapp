# 008 Notification channel details

Date: 2026-11-04 · Status: accepted

- Notifications are per object and recipient: a user with two objects in one warning area gets one per object.
- SMS is only sent to a phone number verified by OTP (`phone_verified_at`).
- If a push send fails for every device (e.g. `DeviceNotRegistered`), an SMS fallback row is created for alert notifications.
- The cancel push goes only to users with an enabled device (spec table: cancel is push only).
- Reminders and invitations by SMS count toward the monthly SMS usage; reminders count as RED.
- Informational pushes (status changes, proposal results, removal) are not stored as notification rows, because `notifications.alert_id` is required.
- iOS `critical` interruption level is used only when `IOS_CRITICAL_ALERTS=true` (after Apple grants the entitlement).

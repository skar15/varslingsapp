# 004 How the claim token reaches both the redirect and the email

Date: 2026-11-04 · Status: accepted

The success redirect and the claim email both need the plain claim token, but the token is created before payment and only its hash may be stored. The API generates the token when it creates the Checkout Session, puts it in the success URL, and puts an AES-256-GCM encrypted copy (`CLAIM_TOKEN_SECRET`) in the session metadata. The webhook decrypts it, stores the SHA-256 hash, and emails the link. The registration page retries for a few seconds when the webhook has not arrived yet. Tokens are single use and expire after 7 days.

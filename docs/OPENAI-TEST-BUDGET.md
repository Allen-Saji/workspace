# OpenAI test-round allowance

On 2026-10-24 the user approved US$1 total for this test round, including retries.
No purchase, recharge, billing upgrade, other paid service or production use is authorized.

The prepared SQLite ledger reserves $0.50 durably BEFORE each transport attempt.
At most two attempts fit. A retry needs a new ID and another reservation. Duplicate IDs,
changed payloads, missing ledgers, unapproved/expired policies and exhausted allowances
fail closed. Independent processes serialize reservations with BEGIN IMMEDIATE.
Timeouts, crashes, HTTP errors and uncertain outcomes never refund an allowance.
The ledger records hashes and reservation state, not prompts, credentials or actual charges.

The fixed text-only request uses gpt-6-luna, default service tier, no tools, 2,048
maximum output tokens (including reasoning), and a fixed structured-output schema.
The conservative envelope uses the full 1,050,000-token context at $0.25/m and output
at $0.50/m: $0.263524 before fees, below the $0.50 reservation.
Sources checked 2026-10-24:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/reasoning

This is an app-only allowance, not a provider-wide billing guarantee. Pricing,
account access, taxes/fees and any other key usage must be checked before activation.
Do not activate if the total charge cannot remain under $1. Policy expires October 31.
Deleting/replacing the ledger is not an authorized budget reset.

## Secure entry and remaining activation

An ignored blank .env.openai.local is prepared in the repository for USER entry of an
existing OPENAI_API_KEY. It is not loaded by the app. Do not paste a key into chat.
After explicit approval for local configuration, the user can open that file in their
local editor and enter the key directly. Do not read/display its value in tool output.
No supported dedicated local secret-entry tool was available.

No actual ledger has been initialized and no default network transport, key loading
or route wiring is enabled. Activation still requires secure configuration consent,
fee/pricing verification, a single protected ledger path, bounded synthetic-only test
runner and reconciliation of provider usage. Never send personal workspace content.
The app continues to expose AI as unavailable. Mock tests do not establish live quality.

# Authentication, workspace and public API audit

Audit date: 9 October 2026. All findings below are fixed in the working tree. Existing product changes were preserved. The six focused suites passed 52 tests using an isolated in-memory database, mocked email delivery, a mocked scheduler, and locally generated signing keys. No real email, OAuth exchange, provider account, payment or production database was used.

## Finding [AUTH-1]: Google linking could activate attacker-planted credentials

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A: no live provider execution)
**Rules Applied**: [R4:✗(local evidence sufficient), R5:✓, R6:✓, R8:✓, R10:✓, R11:✗(no token transfer), R12:✓, R13:✓, R14:✗(no aggregate constraint), R15:✗(no flash loan), R16:✗(no oracle)]
**Preferred Tag**: [POC-PASS]
**Severity**: High
**Location**: src/app/api/auth/google/callback/route.ts; fixed in src/server/domain/auth/google-account.ts:21
**Description**: An attacker could sign up with a victim's email without verifying it. When the victim later signed in through Google, email matching verified and linked that account while preserving the attacker's password and existing session version.
**Impact**: The attacker's known password and pre-verification sessions gained access to the victim's verified account and its future workspaces.
**Evidence**: `tests/auth-concurrency.test.ts` creates an unverified account with a planted password and active session, then links the victim's Google identity. The fixed implementation clears the unproven password, increments `sessionVersion`, retires outstanding codes, and rejects the old session through the real `currentUser()` check. Verified accounts retain their established credentials. Concurrent Google sign-ins create one account.

**Postconditions Created**: Verified access is available only through credentials established by the proven email owner.
**Postcondition Types**: [ACCESS, STATE]
**Who Benefits**: The legitimate account owner.

## Finding [AUTH-2]: Concurrent recovery requests defeated single-use and attempt limits

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A: no live email delivery)
**Rules Applied**: [R4:✗(local evidence sufficient), R5:✓, R6:✗(public account recovery), R8:✓, R10:✓, R11:✗(no token transfer), R12:✓, R13:✓, R14:✓, R15:✗(no flash loan), R16:✗(no oracle)]
**Preferred Tag**: [POC-PASS]
**Severity**: High
**Location**: src/server/domain/auth/codes.ts:24 and :66
**Description**: Code issuance and consumption previously selected state and updated it without serialization. Concurrent requests could issue multiple active codes, reuse one reset code, or overwrite each other's failed-attempt counts.
**Impact**: The five-attempt recovery limit and single-use guarantee did not hold under concurrency.
**Evidence**: `tests/auth-concurrency.test.ts` covers simultaneous resends, duplicate correct reset submissions, and twelve simultaneous wrong guesses. User row locks now serialize issuance and consumption across database clients. Wrong-attempt errors are raised after the transaction commits, preserving all attempt charges. Password reset and global logout increment session versions atomically in SQL.

**Postconditions Created**: One successful consumption per code; exactly five charged wrong guesses retire it; cooldown applies to concurrent resends.
**Postcondition Types**: [ACCESS, STATE, TIMING]
**Who Benefits**: Account owners and operators.

## Finding [AUTH-3]: Membership changes broke owner and billing-account invariants

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A: no live billing)
**Rules Applied**: [R4:✗(local evidence sufficient), R5:✓, R6:✓, R8:✓, R10:✓, R11:✗(membership code makes no token transfer), R12:✓, R13:✓, R14:✓, R15:✗(no flash loan), R16:✗(no oracle)]
**Preferred Tag**: [POC-PASS]
**Severity**: Medium
**Location**: src/server/domain/workspace/members.ts:118 and :135
**Description**: Two simultaneous owner demotions or departures could both pass the owner count check and leave no owner. Removing or demoting the primary owner also left `projects.ownerId` unchanged, even though service billing charges that account. Membership mutators trusted a previously supplied role instead of reading current authority during mutation.
**Impact**: A workspace could lose owner controls, revoked privileges could remain usable by an in-flight mutation, and an account that had left the workspace could continue funding services.
**Evidence**: `tests/auth-concurrency.test.ts` proves one owner remains after simultaneous departures or self-demotions; `projects.ownerId` follows the remaining owner; stale or fabricated actor roles are rejected. Workspace row locks encompass current actor authorization, owner counts, mutation, primary billing-owner transfer, and the audit entry.

**Postconditions Created**: At least one owner remains and the primary billing owner is a current owner.
**Postcondition Types**: [ACCESS, STATE]
**Who Benefits**: Workspace owners and the departing account.

## Finding [AUTH-4]: Post-login paths accepted browser-normalized external redirects

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A: no external navigation performed)
**Rules Applied**: [R4:✗(URL normalization proves the issue), R5:✓, R6:✗(public login input), R8:✓, R10:✓, R11:✗(no token transfer), R12:✓, R13:✗(not design-related), R14:✗(no aggregate constraint), R15:✗(no flash loan), R16:✗(no oracle)]
**Preferred Tag**: [POC-PASS]
**Severity**: Medium
**Location**: src/server/auth/next-step.ts:6
**Description**: The old check accepted strings beginning with `/` except `//`, including `/\\evil.test`, which browsers normalize into an external destination when used as a relative redirect.
**Impact**: A crafted login destination could send a person to an attacker-controlled site after signing in.
**Evidence**: `tests/auth-boundaries.test.ts` covers literal and encoded backslashes, protocol-relative paths, multiple encoding layers, controls, and valid internal paths. Password login and Google sign-in now share the same bounded normalization-aware validator.

**Postconditions Created**: Authentication destinations stay on the application's origin.
**Postcondition Types**: [ACCESS, EXTERNAL]
**Who Benefits**: People signing in.

## Finding [AUTH-5]: Read-only members could invoke stored integration credentials

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A: provider invocation mocked)
**Rules Applied**: [R4:✗(authorization path is explicit), R5:✓, R6:✓, R8:✓, R10:✓, R11:✗(no token transfer), R12:✓, R13:✓, R14:✗(no aggregate constraint), R15:✗(no flash loan), R16:✗(no oracle)]
**Preferred Tag**: [POC-PASS]
**Severity**: Low
**Location**: src/server/actions/integrations.ts:32
**Description**: Integration testing required only `view`, although it invokes stored credentials and writes integration status and diagnostic state.
**Impact**: Viewers and members could use provider credentials, consume provider quota, and change connection diagnostics despite their role.
**Evidence**: `tests/auth-actions-security.test.ts` uses actual verified viewer and owner sessions. The viewer is rejected before the mocked provider runs; the owner succeeds. The action now requires `manage_integrations`. Frontend permission controls were coordinated with the product UI owner.

**Postconditions Created**: Owners and admins control credential-backed connection tests.
**Postcondition Types**: [ACCESS, STATE, EXTERNAL]
**Who Benefits**: Workspace owners and provider account owners.

## Finding [AUTH-6]: Recovery delivery failures revealed existing accounts

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A: email failure mocked)
**Rules Applied**: [R4:✗(response branch is explicit), R5:✓, R6:✗(public recovery input), R8:✓, R10:✓, R11:✗(no token transfer), R12:✓, R13:✓, R14:✗(no aggregate constraint), R15:✗(no flash loan), R16:✗(no oracle)]
**Preferred Tag**: [POC-PASS]
**Severity**: Low
**Location**: src/server/actions/auth.ts:146
**Description**: When email delivery failed, recovery returned an error for an existing account but redirected an unknown address to the reset page.
**Impact**: Provider outages or configuration failures made the forgot-password flow reveal account existence.
**Evidence**: `tests/auth-actions-security.test.ts` injects a delivery failure and confirms both existing and unknown accounts retain the same reset redirect behavior. Delivery failures remain recorded by the email integration.

**Postconditions Created**: Email delivery failures do not change the public account-existence response.
**Postcondition Types**: [ACCESS, EXTERNAL]
**Who Benefits**: Account holders.

## Finding [AUTH-7]: Public webhook bodies were allocated before applying size limits

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A: HTTP requests exercised locally)
**Rules Applied**: [R4:✗(request read order is explicit), R5:✓, R6:✗(public ingestion), R8:✗(single request allocation), R10:✓, R11:✗(no token transfer in request parser), R12:✓, R13:✗(not design-related), R14:✓, R15:✗(no flash loan), R16:✗(no oracle)]
**Preferred Tag**: [POC-PASS]
**Severity**: Medium
**Location**: src/server/security/request-body.ts:6; src/app/api/events/route.ts; src/app/api/webhooks/circle/route.ts:31
**Description**: Event ingestion read an entire body before checking JavaScript character count; Circle notifications had no body bound. Signed malformed Circle JSON also escaped parsing as an unhandled server error.
**Impact**: Unauthenticated oversized requests consumed memory before authentication, and malformed notifications caused unnecessary server errors.
**Evidence**: `tests/auth-boundaries.test.ts` covers multibyte byte limits, overflowing streamed bodies and untrusted content-length headers. `tests/public-api-security.test.ts` verifies 413 for oversized Circle bodies, 400 for locally signed malformed notifications, rejection of invalid key IDs before network lookup, and acceptance of a legitimate queued notification with a null transaction hash. The Circle key cache is bounded; verification diagnostics no longer expose provider details. Scheduler authentication also requires `Bearer` and compares bytes safely.

**Postconditions Created**: Inbound allocations are bounded to 20 KB for events and 100 KB for Circle notifications.
**Postcondition Types**: [STATE, EXTERNAL]
**Who Benefits**: Deployment operators and product users.

## Verified controls and other fixes

- Workspace selection rechecks membership against the database; a workspace cookie is only a preference.
- The roles matrix blocks viewer operations, member approvals, and admin workspace ownership controls.
- Provider credentials remain encrypted with context binding that prevents copying ciphertext between workspaces.
- Invite acceptance uses the stored account email and requires email verification, rechecks the invite under the workspace lock, and succeeds once under concurrent requests.
- Sessions reject malformed signed payloads, missing or nonnumeric expiry, invalid versions and extra token segments. OAuth state expires on the server independently of browser cookie expiry.
- Workspace website, documentation and repository inputs reject non-HTTP protocols.
- Plaintext recovery codes in email-log subjects were identified and delegated to the root agent, which added redaction and migration `0011_redact_email_codes.sql`. The coordinated assertion is present in `tests/auth-billing.test.ts:66` and verifies that the logged subject excludes the delivered code.

The focused verification does not validate live Google, email or Circle configuration, real provider availability, deployed proxy behavior, or multi-instance rate-limit coordination. The in-memory IP token bucket remains per process. Full typechecking, the complete suite and the production build are coordinated by the root audit agent.

Circle's public-key endpoint and key-ID header format were checked against its [notification signature documentation](https://developers.circle.com/api-reference/gateway/all/get-notification-signature).

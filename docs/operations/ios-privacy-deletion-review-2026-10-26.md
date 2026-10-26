# iOS privacy and account deletion review — 2026-10-26

Status: review draft only. Do not publish this as the Privacy Policy or copy it into App Store Connect until the installed binary and provider details have been checked. Scope is ChessBet app 6a4ed72536c51cb3280d2bc6, worldchessbet.com, reported iOS builds 2.133921.2 and .3.

## New provider evidence
Base44's October 26 support reply says both builds use the same shell. Native Firebase analytics starts at launch and collects device/install identifiers and usage events. Reported usage fields include user ID, install ID, device model, OS and language. Native Sentry crash/error reports are tagged with user ID; Base44 says personal data is scrubbed. FullStory is present but not recording. Google Sign-In, Maps and reCAPTCHA are bundled but reportedly not started; Branch is absent. Base44 reports no ATT prompt, no advertising identifier and no tracking under Apple's definition. Treat the latter as a provider claim to verify in the installed binary/network trace, not clearance.

The website's cookie gate controls its named WebView/website analytics and advertising endpoints. It cannot prevent native Firebase launch collection or Sentry. WebView user agent is unverified; test it on iPhone and iPad. Base44 says shell privacy manifests omit the described analytics and it cannot change shell components, usage descriptions, background-location entry or transport settings per app. Base44 has not supplied a full SDK inventory or retention periods for native logs/identifiers. Account deletion removes account and local session, but provider-managed Sign in with Apple token revocation is unavailable.

## App Privacy questionnaire mapping for review
These are affirmative candidates from the provider reply, additional to the web/game/financial categories in the current policy. Confirm each purpose and linkage against SDK behavior before entering it in App Store Connect.

| Apple data type | Evidence | Proposed linkage and purpose |
| --- | --- | --- |
| Identifiers > User ID | Firebase usage fields and Sentry event tag contain user ID | Linked to user; Analytics for Firebase, App Functionality for crash/error diagnosis |
| Identifiers > Device ID | Firebase install/device identifier | Treat as linked to device/user for App Privacy review; Analytics. Confirm exact identifier and whether persistent install ID meets Apple's Device ID definition |
| Usage Data > Product Interaction | Firebase launch and usage events | Linked where user/install ID accompanies event; Analytics |
| Diagnostics > Crash Data | Sentry crash/error reports | Linked because user ID is attached; App Functionality |
| Diagnostics > Other Diagnostic Data | Sentry error reports, device model/OS/language if included | Linked when tagged with user ID; App Functionality. Confirm whether any Performance Data is sent before selecting it |

Do not mark all collection unlinked because payload scrubbing is not removal of the user ID. Do not infer ATT tracking solely from analytics; inspect SDK data sharing and cross-app linkage before deciding the Tracking answer. The web app already collects separate account, gameplay, location, payment and support data that must remain in the full questionnaire. Native launch collection is not optional in the current shell; do not describe it as conditional on web cookie consent.

## Proposed Privacy Policy edits for legal/product review
Current active policy is version 5 dated 2026-10-20. Draft a new version through the existing versioned legal publisher only after review; keep old historical versions intact.

- In “Information Collected Automatically,” append: “In the ChessBet iOS app, Base44's native shell starts Firebase analytics when the app launches. It reports app launch and usage events with an app installation identifier and device information such as model, operating system and language. When a user is signed in, reported usage information can include the ChessBet user ID. These native analytics operate separately from the website cookie choices.”
- In “Third-Party Service Providers,” append: “Base44's iOS shell uses Firebase for app analytics and Sentry for crash and error reporting. Sentry reports can include the ChessBet user ID and device/technical details; Base44 says personal data in report contents is scrubbed. FullStory is included in the shell but Base44 reports that recording is disabled. Some other bundled components are not started in the current app configuration.” Verify the last two claims in the installed build before publication.
- In “Cookies and Similar Technologies,” qualify every statement that optional analytics are off before consent as applying to *website/WebView optional analytics*, and explicitly state: “Cookie choices do not control the iOS shell's launch analytics or crash diagnostics.” Replace the current iPhone/iPad paragraph's broad implication with: “On iPhone and iPad, ChessBet suppresses its optional website/WebView Base44 visitor analytics, Google Analytics and Meta advertising requests. This does not disable native Firebase app analytics or Sentry crash/error reporting in the iOS shell.”
- In “Account Closure and Data Retention,” append: “We include applicable provider-held app analytics identifiers and diagnostic records in deletion review. Their retention periods have not yet been confirmed by Base44, so we do not promise a fixed deletion period for them. Sign in with Apple access may require a separate revocation step when provider-held tokens are unavailable; we will explain that step during fulfillment.” Have counsel/owner approve the exact wording and provider facts before publication.

## Deletion and native readiness
The in-app Profile deletion request and public /account-deletion path are present. Request creation is authenticated, confirmation-gated, idempotent for an open request, and does not close the wallet or cancel games. Admin completion requires MFA, recorded fulfillment evidence, a prior review state, and a Base44 User 404; provider failures do not count as deletion. Existing Close Account is separate and preserves financial controls. No real account should be deleted to validate this path.

Before submission, use a disposable unfunded test account to confirm navigation, request/status, manual provider data review, user-record removal, signed-out state, completion notice and Sign in with Apple handling. Base44 must provide a workable Apple token revocation route or the owner must document the applicable Apple manual fallback; do not claim token revocation succeeded without evidence. Resolve pending funds/contests only through established controls.

Obtain the actual IPA for the build to submit; enumerate all SDKs and embedded NSPrivacyTracking/NSPrivacyCollectedDataTypes manifests, required-reason API entries, IDFA references, background location purpose and transport settings. Request a corrected shell manifest or binary from Base44 where needed. Capture a fresh-install network trace before web content loads, after sign-in, and after cookie choices on iPhone and iPad. Check Firebase and Sentry payloads/retention, FullStory activity, WebView UA and dormant SDKs. Reconcile the binary's privacy report and App Store Connect answers. A label update does not repair a missing required SDK manifest.

## Official Apple sources
- https://developer.apple.com/app-store/app-privacy-details/
- https://developer.apple.com/support/third-party-SDK-requirements/
- https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests
- https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/
- https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple

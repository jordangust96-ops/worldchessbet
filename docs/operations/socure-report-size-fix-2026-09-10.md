# Socure result synchronization: report-size fix

Confirmed live failure: provider result retrieval/classification succeeded, but Base44 rejected provider_report_ciphertext for exceeding the per-field size limit. The local row and User projection remained pending.

Socure webhook and canonical API recovery now pass compress:true to encryptComplianceJson. Full JSON is gzip-compressed before AES-GCM encryption; nothing is omitted. The SHA-256 is computed from original JSON bytes. Compressed archives carry the self-describing prefix gzip-aesgcm-v1:; older unprefixed archives retain the original format. To recover: remove the prefix, Base64-decode ciphertext/IV, AES-GCM decrypt using the protected audit key, gzip-decompress, then verify the original SHA-256. Never upload plaintext identity evidence to public storage.

Live confirmation: current evaluation b9fe3a3b-0ec8-4022-b356-661cb6ba94af synchronized ACCEPT/verified. Its encrypted archive is 6007 characters, hash is present, API provenance matches the evaluation, and the User projection is verified with age-over-21 evidence. Earlier superseded attempt remains historical; no approval was fabricated and no money movement occurred.

Validation: archive compression/decryption round trip, original hash, backward-compatible uncompressed mode and tamper rejection; Socure return-flow and identity test suites; lint; production build all passed. Error output in injected-failure tests is expected.

Browser connection was unavailable; live verification used database evidence and account flags, not a claimed visual browser check. Previous wallet UI simplification remains subject to frontend publication.

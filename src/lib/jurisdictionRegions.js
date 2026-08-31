// Frontend re-export of the canonical, dependency-free jurisdiction region
// data living in base44/shared/jurisdictionRegions.js. One source of truth for
// the opt-in country / U.S. state selectors, the allowlist parity test, and
// the centralized server approval test. Pure data and pure helpers — no React.
export {
  APPROVED_STATES,
  US_REGIONS,
  ISO_COUNTRIES,
  normalizeCountryCode,
  normalizeRegionCode,
  isValidIsoCountry,
  isValidUsRegion,
  getCountryName,
  getRegionName,
  isLocationApproved,
} from "../../base44/shared/jurisdictionRegions.js";
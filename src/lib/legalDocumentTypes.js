// Shared metadata for every legal document type that a user must review and
// accept. Keeps the guard, prompt, viewer, and admin editor all in sync
// without duplicating routes/labels/icons in each place.
import { Shield, FileText, Scroll } from "lucide-react";

export const POLICY_TYPE_ORDER = ["privacy_policy", "terms_of_service", "official_rules"];

export const LEGAL_DOCUMENT_TYPES = {
  privacy_policy: {
    key: "privacy_policy",
    label: "Privacy Policy",
    route: "/privacy-policy",
    adminRoute: "/admin/privacy-policy",
    icon: Shield,
    seoDescription:
      "Learn how ChessBet collects, uses, and protects your personal data, including identity verification, payment details, and account activity information.",
  },
  terms_of_service: {
    key: "terms_of_service",
    label: "Terms of Service",
    route: "/terms-of-service",
    adminRoute: "/admin/terms-of-service",
    icon: FileText,
    seoDescription:
      "Review ChessBet's Terms of Service outlining account eligibility, wager rules, platform fees, dispute resolution, and your rights as a registered player.",
  },
  official_rules: {
    key: "official_rules",
    label: "Official Rules",
    route: "/official-rules",
    adminRoute: "/admin/official-rules",
    icon: Scroll,
    seoDescription:
      "Read ChessBet's Official Rules governing skill-based chess contests, entry amounts, match settlement, fair play standards, and eligibility requirements.",
  },
};
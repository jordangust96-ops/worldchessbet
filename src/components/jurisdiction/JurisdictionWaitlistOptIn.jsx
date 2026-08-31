import React, { useMemo, useState } from "react";
import { Mail, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  ISO_COUNTRIES,
  US_REGIONS,
  getCountryName,
  getRegionName,
} from "@/lib/jurisdictionRegions";

// Opt-in for the blocked-jurisdiction waitlist. Shown ONLY by
// JurisdictionAccessGuard when the jurisdiction response positively determined
// the authenticated user is outside the approved jurisdictions (status
// "blocked", enforcement on, no anonymizer). Never shown for VPN/proxy,
// provider errors, unknown/missing location, or disabled enforcement.
//
// Uses the authenticated user's account email for delivery (no free-form email
// field is requested or displayed as editable input). Country selector lists
// all ISO countries; U.S. state selector (required) lists all 50 states plus
// the District of Columbia. Confirms the selected location before saving and
// gives clear success, validation, and safe retryable error states.

export default function JurisdictionWaitlistOptIn({ userEmail }) {
  const [phase, setPhase] = useState("ask"); // ask | form | confirm | saving | success | error | declined
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [validationError, setValidationError] = useState("");
  const [submitError, setSubmitError] = useState("");

  const usSelected = country === "US";

  const locationSummary = useMemo(() => {
    if (!country) return "";
    const cName = getCountryName(country) || country;
    if (usSelected) {
      const rName = (region && (getRegionName(region) || region)) || "";
      return rName ? `${rName}, ${cName}` : cName;
    }
    return cName;
  }, [country, region, usSelected]);

  function validate() {
    if (!country) return "Please select your country.";
    if (usSelected && !region) return "Please select your U.S. state.";
    return "";
  }

  function handleYes() {
    setValidationError("");
    setPhase("form");
  }
  function handleNo() {
    setPhase("declined");
  }
  function backToForm() {
    setPhase("form");
  }
  function handleConfirm() {
    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError("");
    setPhase("confirm");
  }
  async function handleSave() {
    setSubmitError("");
    setPhase("saving");
    try {
      const res = await base44.functions.invoke("upsertJurisdictionInterest", {
        selectedCountryCode: country,
        selectedRegionCode: usSelected ? region : "",
      });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);
      setPhase("success");
    } catch (e) {
      setSubmitError(e?.message || "We couldn't save your preference. Please try again.");
      setPhase("error");
    }
  }

  const cardClass = "w-full rounded-2xl border border-border bg-card/60 p-4 text-left";

  if (phase === "success") {
    return (
      <div className={cardClass}>
        <div className="mb-2 flex items-center gap-2 text-primary">
          <Check className="h-4 w-4" />
          <span className="text-sm font-semibold text-foreground">You're on the list</span>
        </div>
        <p className="font-body text-sm text-muted-foreground">
          Thanks — we'll email <span className="text-foreground">{userEmail || "you"}</span> when real-money play is available in your selected location.
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className={cardClass}>
        <p className="font-body text-sm text-destructive mb-3">{submitError}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={backToForm}>Edit selection</Button>
          <Button variant="default" size="sm" onClick={handleSave}>Try again</Button>
        </div>
      </div>
    );
  }

  if (phase === "declined") {
    return (
      <div className={cardClass}>
        <p className="font-body text-sm text-muted-foreground mb-1">
          No problem. You can opt in any time you're asked.
        </p>
        <Button variant="link" className="px-0" onClick={() => setPhase("ask")}>Notify me instead</Button>
      </div>
    );
  }

  if (phase === "ask") {
    return (
      <div className={cardClass + " flex items-center justify-center gap-2"}>
        <Button variant="default" size="sm" onClick={handleYes}>Yes</Button>
        <Button variant="outline" size="sm" onClick={handleNo}>No</Button>
      </div>
    );
  }

  // form | confirm | saving share one shell.
  const readOnly = phase === "saving" || phase === "confirm";

  return (
    <div className={cardClass}>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ji-country" className="text-xs uppercase tracking-wider text-muted-foreground">
            Country
          </Label>
          <Select
            value={country}
            onValueChange={(v) => {
              setCountry(v);
              setRegion("");
              setValidationError("");
            }}
            disabled={readOnly}
          >
            <SelectTrigger id="ji-country">
              <SelectValue placeholder="Select your country" />
            </SelectTrigger>
            <SelectContent>
              {ISO_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {usSelected && (
          <div className="space-y-2">
            <Label htmlFor="ji-region" className="text-xs uppercase tracking-wider text-muted-foreground">
              U.S. State
            </Label>
            <Select
              value={region}
              onValueChange={(v) => {
                setRegion(v);
                setValidationError("");
              }}
              disabled={readOnly}
            >
              <SelectTrigger id="ji-region">
                <SelectValue placeholder="Select your state" />
              </SelectTrigger>
              <SelectContent>
                {US_REGIONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            We'll use <span className="text-foreground">{userEmail || "your account email"}</span> — we never ask for your email here.
          </span>
        </div>

        {validationError && <p className="text-xs text-destructive">{validationError}</p>}

        {phase === "form" && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPhase("ask")}>Back</Button>
            <Button variant="default" size="sm" onClick={handleConfirm}>Confirm location</Button>
          </div>
        )}

        {phase === "confirm" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Please confirm: we'll notify <span className="text-foreground">{userEmail || "you"}</span> when ChessBet becomes available in{" "}
              <span className="text-foreground">{locationSummary}</span>.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={backToForm}>Edit</Button>
              <Button variant="default" size="sm" onClick={handleSave}>Save preference</Button>
            </div>
          </div>
        )}

        {phase === "saving" && <p className="text-xs text-muted-foreground">Saving…</p>}
      </div>
    </div>
  );
}
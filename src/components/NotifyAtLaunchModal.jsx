import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from "@/api/base44Client";

export default function NotifyAtLaunchModal({ open, onOpenChange }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reset each time the modal opens, and try to pre-fill from the logged-in user.
    setSubmitted(false);
    setEmail("");
    setUsername("");
    setUserId(null);
    base44.auth
      .me()
      .then((me) => {
        setUserId(me.id);
        setUsername(me.full_name || "");
        setEmail(me.email || "");
      })
      .catch(() => {});
  }, [open]);

  const handleSubmit = async () => {
    if (!email) return;
    setIsSubmitting(true);
    try {
      await base44.entities.LaunchNotification.create({
        email,
        user_id: userId || undefined,
        username: username || undefined,
        submitted_at: new Date().toISOString(),
      });
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl bg-[#141414] border border-white/10">
        {submitted ? (
          <div className="text-center py-4">
            <p className="text-lg font-bold text-[#C9A84C] mb-2">You're on the list!</p>
            <p className="text-sm text-white/50">
              We'll let you know as soon as real-money competitive play becomes available on ChessBet.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-white">Get Notified at Launch</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-white/50 -mt-2 mb-2">
              Be among the first to know when ChessBet officially launches real-money competitive play.
              We'll send you a notification as soon as it's available.
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="notify-email" className="text-white/70 text-xs">
                  Email address
                </Label>
                <Input
                  id="notify-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notify-username" className="text-white/70 text-xs">
                  ChessBet username (optional)
                </Label>
                <Input
                  id="notify-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={!!userId}
                  placeholder="Your username"
                  className="bg-white/5 border-white/10 text-white disabled:opacity-60"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button
                variant="outline"
                className="flex-1 border-white/10 text-white/70 hover:bg-white/5"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 gold-gradient text-black font-bold hover:opacity-90"
                onClick={handleSubmit}
                disabled={!email || isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Notify Me"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
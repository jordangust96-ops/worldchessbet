import React, { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { base44 } from "@/api/base44Client";

export default function DeleteAccountButton({ onClosed }) {
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    setClosing(true);
    setError("");
    try {
      const { data } = await base44.functions.invoke("closeAccount", {});
      if (data?.error) {
        setError(data.error);
        setClosing(false);
        return;
      }
      onClosed?.();
    } catch (e) {
      setError("Something went wrong closing your account. Please try again.");
      setClosing(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          className="w-full h-12 rounded-2xl text-white/30 hover:text-red-400 hover:bg-red-500/5 font-medium"
        >
          <Trash2 size={16} className="mr-2" />
          Delete Account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This will cancel any open contest invitations, prevent entry into new contests, and
            permanently close your account. Any remaining undisputed balance will be queued for
            disbursement, subject to verification, compliance holds, and processing times. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-xs text-red-400 -mt-2">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={closing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={closing}
            className="bg-red-500 text-white hover:bg-red-600"
          >
            {closing ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
            Close Account
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
"use client"

import { OTPInput, REGEXP_ONLY_DIGITS } from "input-otp"
import { cn } from "@/lib/utils"

export function ConfirmationCode({ value, onChange, disabled, invalid }: { value: string; onChange: (value: string) => void; disabled: boolean; invalid: boolean }) {
  return <OTPInput id="confirmation-code" aria-label="Confirmation code" aria-invalid={invalid} aria-describedby={invalid ? "confirmation-error" : undefined}
    maxLength={6} pattern={REGEXP_ONLY_DIGITS} inputMode="numeric" autoComplete="one-time-code"
    value={value} onChange={onChange} disabled={disabled} pushPasswordManagerStrategy="none"
    containerClassName="flex w-full justify-center gap-1"
    render={({ slots }) => <div aria-hidden="true" className="flex w-full max-w-xs items-center justify-center gap-1">
      {slots.map((slot, index) => <div key={index} data-slot="confirmation-digit" className={cn(
        "flex h-11 min-w-0 flex-1 items-center justify-center rounded-md border border-input text-lg tabular-nums",
        index === 3 && "ml-2", slot.isActive && "border-ring ring-2 ring-ring/50", invalid && "border-destructive",
      )}>{slot.char ?? (slot.hasFakeCaret ? <span className="h-5 w-px bg-foreground" /> : null)}</div>)}
    </div>} />
}

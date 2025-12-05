export function BackbeatLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="36"
      height="18"
      viewBox="0 0 36 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M0 0H18V9H0V0Z" fill="currentColor" />
      <path d="M18 9H36V18H18V9Z" fill="currentColor" />
      <path
        d="M20.8351 8.99855C21.3071 9.00256 21.8577 8.99855 22.5 8.99855H20.8351C18 8.97442 18 8.66048 18 5.44572V8.99855H20.8351Z"
        fill="currentColor"
      />
      <path
        d="M15.1649 9.00146C14.6929 8.99744 14.1423 9.00146 13.5 9.00146L15.1649 9.00146C18 9.02558 18 9.33952 18 12.5543V9.00146H15.1649Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function BackbeatLogoFull({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <BackbeatLogo className="h-6 w-auto" />
      <span className="text-lg font-semibold tracking-tight">Backbeat</span>
    </div>
  )
}

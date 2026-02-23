export function Button({ className = "", size = "default", variant = "default", children, ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 "
  const variants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
  }
  const sizes = {
    default: "h-9 px-4 py-2",
    lg: "h-10 px-6 text-sm",
  }
  return (
    <button
      className={base + (variants[variant] || variants.default) + " " + (sizes[size] || sizes.default) + " " + className}
      {...props}
    >
      {children}
    </button>
  )
}

import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import { t } from "@/lib/i18n"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    // The registry hard-codes aria-label="Loading"; this app is translated,
    // so the default name goes through t(). A caller's own aria-label wins.
    <Loader2Icon data-slot="spinner" role="status" aria-label={t('Loading')} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }

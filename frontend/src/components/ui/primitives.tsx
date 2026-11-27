import { useRef, type ComponentProps, type ReactNode, type RefObject } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'

// Local shadcn/ui primitives. Keep native form inputs and selects so form
// submission, multiple selection, browser autofill and keyboard behavior carry over.
export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values))
}

export const buttonVariants = cva('ui-button', {
  variants: {
    variant: {
      default: 'ui-button-primary',
      outline: 'ui-button-outline',
      soft: 'ui-button-soft',
      ghost: 'ui-button-ghost',
      destructive: 'ui-button-destructive',
      plain: 'ui-button-plain',
    },
    size: { default: 'ui-button-default', sm: 'ui-button-small', icon: 'ui-button-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

export function Button({ className, variant, size, asChild, ...props }: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button'
  return <Component data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section data-slot="card" className={cn('surface', className)} {...props} />
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn('ui-input', className)} {...props} />
}

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select data-slot="native-select" className={cn('ui-input', className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn('ui-input', className)} {...props} />
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return <table data-slot="table" className={cn('ui-table', className)} {...props} />
}

export function Badge({ className, tone = 'neutral', ...props }: ComponentProps<'span'> &
  { tone?: 'neutral' | 'positive' | 'warning' | 'danger' }) {
  return <span data-slot="badge" className={cn('ui-badge', `ui-tone-${tone}`, className)} {...props} />
}

const noticeIcon = { neutral: Info, positive: CircleCheck, warning: TriangleAlert, danger: CircleAlert }
export function Alert({ className, tone = 'neutral', children, ...props }: ComponentProps<'div'> &
  { tone?: keyof typeof noticeIcon }) {
  const Icon = noticeIcon[tone]
  return <div data-slot="alert" className={cn('ui-alert', `ui-tone-${tone}`, className)} {...props}>
    <Icon size={17} aria-hidden="true" /><div>{children}</div>
  </div>
}

export const Tabs = TabsPrimitive.Root
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn('ui-tabs-list', className)} {...props} />
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn('ui-tabs-trigger', className)} {...props} />
}
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('ui-tabs-content', className)} {...props} />
}

export function SurfaceDialog({ title, description, actions, children, onClose, className, sheet = false,
  closeDisabled = false, returnFocus, closeLabel = 'Đóng' }: {
  title: string; description?: string; actions?: ReactNode; children: ReactNode; onClose: () => void
  className?: string; sheet?: boolean; closeDisabled?: boolean; returnFocus?: RefObject<HTMLElement | null>; closeLabel?: string
}) {
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open && !closeDisabled) onClose() }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn('ui-dialog-overlay', sheet && 'ui-sheet-overlay')} />
      <DialogPrimitive.Content data-slot={sheet ? 'sheet-content' : 'dialog-content'}
        className={cn('ui-dialog', sheet && 'ui-sheet', className)}
        {...(!description ? { 'aria-describedby': undefined } : {})}
        onEscapeKeyDown={e => { if (closeDisabled) e.preventDefault() }}
        onPointerDownOutside={e => { if (closeDisabled) e.preventDefault() }}
        onCloseAutoFocus={e => {
          const target = returnFocus?.current ?? previousFocus.current
          if (!target?.isConnected) return
          e.preventDefault()
          target.focus({ preventScroll: true })
        }}>
        <header className="ui-dialog-header">
          <div>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description>{description}</DialogPrimitive.Description>}
          </div>
          <div className="ui-dialog-actions">{actions}
            <DialogPrimitive.Close asChild><Button variant="outline" size="sm" disabled={closeDisabled}>
              {closeLabel}
            </Button></DialogPrimitive.Close>
          </div>
        </header>
        <div className="ui-dialog-body">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

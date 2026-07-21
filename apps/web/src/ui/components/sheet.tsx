import * as React from 'react';
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

import { cn } from '@/ui/lib/cn.js';

const Sheet = DrawerPrimitive.Root;

const SheetTrigger = DrawerPrimitive.Trigger;

const SheetClose = DrawerPrimitive.Close;

const SheetPortal = DrawerPrimitive.Portal;

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Backdrop>) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/55 transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

const sheetViewportVariants = cva('fixed inset-0 z-50 flex', {
  variants: {
    side: {
      top: 'items-start justify-stretch',
      bottom: 'items-end justify-stretch',
      left: 'items-stretch justify-start',
      right: 'items-stretch justify-end',
    },
  },
  defaultVariants: { side: 'right' },
});

const sheetVariants = cva(
  'flex flex-col gap-4 border-line bg-surface p-6 text-fg shadow-lg outline-none transition-transform duration-300 ease-in-out',
  {
    variants: {
      side: {
        top: 'w-full border-b data-starting-style:-translate-y-full data-ending-style:-translate-y-full',
        bottom:
          'w-full border-t data-starting-style:translate-y-full data-ending-style:translate-y-full',
        left: 'h-full w-3/4 border-r data-starting-style:-translate-x-full data-ending-style:-translate-x-full sm:max-w-xl',
        right:
          'h-full w-3/4 border-l data-starting-style:translate-x-full data-ending-style:translate-x-full sm:max-w-xl',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

interface SheetContentProps
  extends React.ComponentProps<typeof DrawerPrimitive.Popup>, VariantProps<typeof sheetVariants> {}

function SheetContent({
  side = 'right',
  className,
  children,
  finalFocus,
  ...props
}: SheetContentProps) {
  // Unlike `Dialog.Popup`, `DrawerPrimitive.Popup`'s own default return-focus tracking does not
  // reliably restore focus to the element that was focused before the sheet opened (observed: it
  // lands on `<body>` on close instead). Captured synchronously during this component's first
  // render -- before any mount effect (the sheet's own initial-focus effect included) can move
  // focus -- so it always holds whatever was focused immediately before the sheet opened.
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);
  if (previouslyFocusedRef.current === null && typeof document !== 'undefined') {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
  }
  return (
    <SheetPortal>
      <SheetOverlay />
      <DrawerPrimitive.Viewport className={sheetViewportVariants({ side })}>
        <DrawerPrimitive.Popup
          data-slot="sheet-content"
          className={cn(sheetVariants({ side }), className)}
          finalFocus={finalFocus ?? previouslyFocusedRef}
          {...props}
        >
          <DrawerPrimitive.Content className="relative flex h-full flex-col gap-4">
            {children}
          </DrawerPrimitive.Content>
          <DrawerPrimitive.Close className="absolute right-4 top-4 rounded-sm text-muted opacity-70 transition-opacity hover:opacity-100 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DrawerPrimitive.Close>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col space-y-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        'font-serif text-base font-normal uppercase tracking-[0.12em] text-fg-strong',
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};

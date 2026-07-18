import { Component, type ErrorInfo, type ReactNode } from 'react';

interface OverlayErrorBoundaryProps {
  readonly children: ReactNode;
}

interface OverlayErrorBoundaryState {
  readonly hasError: boolean;
}

/**
 * Wraps an overlay's own body content (NOT the surrounding `Sheet`/`Dialog` frame -- see
 * `OverlayHost.tsx`'s composition: `<SheetContent>/<DialogContent><OverlayErrorBoundary>{body}
 * </OverlayErrorBoundary></SheetContent>/</DialogContent>`). A render error inside the body is
 * caught here instead of unmounting everything above it: the surrounding primitive's own dialog
 * frame (role, Esc handling, focus trap) stays mounted, and -- because that primitive is the only
 * thing between the body and the rest of the app -- the play surface underneath is never touched.
 * Isolates a throwing overlay body so a render error shows a contained alert instead of crashing
 * the client.
 */
export class OverlayErrorBoundary extends Component<OverlayErrorBoundaryProps, OverlayErrorBoundaryState> {
  public override state: OverlayErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): OverlayErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- surfaced visibly below too; this is the developer trail.
    console.error('Overlay content failed to render:', error, info.componentStack);
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <p role="alert" className="overlay-error">
          This screen hit a bug — Esc to close. The run is unaffected.
        </p>
      );
    }
    return this.props.children;
  }
}

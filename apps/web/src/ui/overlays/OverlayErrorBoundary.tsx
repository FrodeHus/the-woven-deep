import { Component, type ErrorInfo, type ReactNode } from 'react';

interface OverlayErrorBoundaryProps {
  readonly children: ReactNode;
}

interface OverlayErrorBoundaryState {
  readonly hasError: boolean;
}

/**
 * Wraps an overlay's own body content (NOT the surrounding `OverlayScaffold` frame -- see
 * `PlayScreen`/`App`'s overlay host composition: `<OverlayScaffold><OverlayErrorBoundary>{body}
 * </OverlayErrorBoundary></OverlayScaffold>`). A render error inside the body is caught here
 * instead of unmounting everything above it: the scaffold's own dialog frame (role, Esc handling,
 * focus trap) stays mounted, and -- because the scaffold is the only thing between the body and
 * the rest of the app -- the play surface underneath is never touched. Before this task there was
 * no React error boundary anywhere in `apps/web`; a throwing overlay would otherwise crash the
 * whole client to a white screen.
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

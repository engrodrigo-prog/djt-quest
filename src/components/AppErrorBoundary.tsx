import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const isDev = typeof import.meta !== "undefined" && Boolean((import.meta as any)?.env?.DEV);

type Props = { children: ReactNode };
type State = { hasError: boolean; errorMessage?: string };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown) {
    console.error("AppErrorBoundary caught:", error);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-lg border bg-card p-6 shadow-sm space-y-3">
          <div className="text-lg font-semibold">Algo deu errado</div>
          <div className="text-sm text-muted-foreground">
            O app encontrou um erro inesperado. Recarregue a página para tentar novamente.
          </div>

          {isDev && this.state.errorMessage ? (
            <pre className="text-xs whitespace-pre-wrap break-words rounded bg-muted p-3">
              {this.state.errorMessage}
            </pre>
          ) : null}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={this.handleReload} className="w-full">
              Recarregar
            </Button>
            <Button variant="secondary" onClick={this.handleReset} className="w-full">
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }
}


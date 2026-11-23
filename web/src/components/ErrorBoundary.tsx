import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../i18n/I18nContext";

// A crash while drawing a screen used to leave the page blank. This catches
// it and offers a reload. `resetKey` (the route) clears it on navigation, so
// one broken screen doesn't lock the rest of the app.
interface Props { children: ReactNode; resetKey?: string }
interface State { failed: boolean; key?: string }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen crashed", error, info.componentStack);
  }

  render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}

function CrashScreen() {
  const { t } = useT();
  return (
    <div className="crash-screen card" role="alert">
      <AlertTriangle aria-hidden="true" />
      <h2>{t("crash.title")}</h2>
      <p className="sub">{t("crash.text")}</p>
      <button type="button" className="btn" onClick={() => window.location.reload()}>{t("crash.reload")}</button>
    </div>
  );
}

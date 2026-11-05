import { t, useLocale } from '../i18n/index.ts'
import { Component, type ReactNode } from 'react'

// A failed lazy import or renderer must not unmount the Workspace navigation.
export default class ReportBoundary extends Component<{
  children: ReactNode
  onHome: () => void
}, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return <ReportError error={this.state.error} onHome={this.props.onHome} />
  }
}

function ReportError({ error, onHome }: { error: Error; onHome: () => void }) {
  useLocale()
  return <div className="report-error" role="alert">
      <strong>{t("This report could not be opened.")}</strong>
      <p>{t("Reload to try again, or return to your Workspace. Your project files have not changed.")}</p>
      <div className="report-error-actions">
        <button onClick={() => window.location.reload()}>{t("Reload page")}</button>
        <button onClick={onHome}>{t("Back to Workspace")}</button>
      </div>
      <details><summary>{t("Error details")}</summary><pre>{error.message || String(error)}</pre></details>
    </div>
}

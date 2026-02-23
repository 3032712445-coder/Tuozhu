import { Component } from "react"

/** 捕获子组件抛错，避免整页白屏 */
export class ErrorBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary:", error, info)
  }

  render() {
    if (this.state.hasError) {
      const fallback = this.props.fallback
      if (typeof fallback === "function") {
        return fallback({
          error: this.state.error,
          reset: () => this.setState({ hasError: false, error: null }),
        })
      }
      return (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded bg-red-50 p-4 text-center text-sm text-red-800">
          <p className="font-medium">3D 预览加载出错</p>
          <p className="text-xs text-red-600">{this.state.error?.message ?? "未知错误"}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded bg-red-200 px-3 py-1.5 text-xs font-medium hover:bg-red-300"
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

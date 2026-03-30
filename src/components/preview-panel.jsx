import { Suspense, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { Scene3D } from "./Scene3D"
import { ErrorBoundary } from "./ErrorBoundary"

console.log("🔥 PreviewPanel from components loaded")
export function PreviewPanel({
  depthVersion,
  depthUrl,
  isGenerated,
  isAdjustMode,
  onAdjustModeToggle,
  reliefPosition,
  onReliefPositionChange,
  embossHeight,
  embossSize,
  reliefRotation,
  depthMapUrl,
  phoneModel,
}) {
  const [isEraserMode, setIsEraserMode] = useState(false)
  
  // 擦除逻辑：通过 Canvas 修改深度图
  const handleEraserDraw = (uv) => {
    // 这是一个简化实现，实际可能需要更复杂的 Canvas 操作
    // 这里我们假设 depthUrl 是一个 Blob URL 或 Data URL，我们需要将其加载到 Canvas 上修改
    // 为了性能，建议在 Scene3D 内部维护一个 CanvasTexture，并直接操作它
    console.log("Erase at UV:", uv)
  }

  return (
    <div className="relative flex h-full min-h-[400px] flex-col rounded-lg border border-border/60 bg-muted/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">3D 预览</h3>
          {isGenerated && (
            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-500">
              已生成
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {/* 只有在调整模式下才显示擦除按钮 */}
          {isGenerated && isAdjustMode && (
            <button
              type="button"
              onClick={() => setIsEraserMode(!isEraserMode)}
              className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isEraserMode
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-background hover:bg-accent text-foreground"
              }`}
            >
              {isEraserMode ? "退出擦除" : "擦除"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
                // 如果退出调整模式，强制退出擦除模式
                if (isAdjustMode) setIsEraserMode(false)
                onAdjustModeToggle()
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {isAdjustMode ? "完成调整" : "调整位置"}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-[360px] rounded bg-muted/50 overflow-hidden relative">
        <ErrorBoundary>
          {isGenerated && isEraserMode && (
            <div className="absolute top-4 left-4 z-10 rounded bg-black/50 px-3 py-1.5 text-xs text-white pointer-events-none">
              按住鼠标左键擦除浮雕
            </div>
          )}
          <div className="h-full w-full">
            {typeof window !== 'undefined' && window.WebGLRenderingContext ? (
              <Canvas
                camera={{ position: [0, 0, 15], fov: 50 }}
                gl={{
                  powerPreference: "default",
                  alpha: false,
                  depth: true,
                  stencil: false,
                  antialias: false,
                  preserveDrawingBuffer: false
                }}
                dpr={1}
                style={{ width: "100%", height: "100%", display: "block" }}
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    WebGL 初始化失败，无法显示 3D 预览
                  </div>
                }
              >
                <color args={[1, 1, 1, 1]} attach="background" />
            <Suspense
              fallback={
                <mesh>
                  <boxGeometry args={[1, 1, 1]} />
                  <meshBasicMaterial color="#888" wireframe />
                </mesh>
              }
            >
              <Scene3D
                depthVersion={depthVersion}
                depthUrl={depthUrl}
                isGenerated={isGenerated}
                isAdjustMode={isAdjustMode}
                reliefPosition={reliefPosition}
                onReliefPositionChange={onReliefPositionChange}
                embossHeight={embossHeight ?? [5]}
                embossSize={embossSize ?? [60]}
                reliefRotation={reliefRotation ?? 0}
                phoneModel={phoneModel}
                isEraserMode={isEraserMode}
                onEraserDraw={handleEraserDraw}
              />
            </Suspense>
          </Canvas>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    您的浏览器不支持 WebGL，无法显示 3D 预览
                  </div>
                )}
          </div>
        </ErrorBoundary>
      </div>
    </div>
  )
}
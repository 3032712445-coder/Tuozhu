import { Suspense } from "react"
import { Canvas } from "@react-three/fiber"
import { Scene3D } from "./Scene3D"
import { ErrorBoundary } from "./ErrorBoundary"

export function PreviewPanel({
  isGenerated,
  isAdjustMode,
  onAdjustModeToggle,
  reliefPosition,
  onReliefPositionChange,
  embossHeight,
  embossSize,
  reliefRotation,
}) {
  return (
    <div className="relative flex h-full min-h-[400px] flex-col rounded-lg border border-border/60 bg-muted/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">3D 预览</h3>
        <button
          type="button"
          onClick={onAdjustModeToggle}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {isAdjustMode ? "完成调整" : "调整位置"}
        </button>
      </div>
      <div className="flex-1 min-h-[360px] rounded bg-muted/50 overflow-hidden relative">
        <ErrorBoundary>
          <Canvas
            shadows
            camera={{ position: [0, 0, 15], fov: 50 }}
            gl={{ antialias: true }}
            style={{ width: "100%", height: "100%", display: "block" }}
          >
            <Suspense
              fallback={
                <mesh>
                  <boxGeometry args={[1, 1, 1]} />
                  <meshBasicMaterial color="#888" wireframe />
                </mesh>
              }
            >
              <Scene3D
                isGenerated={isGenerated}
                isAdjustMode={isAdjustMode}
                reliefPosition={reliefPosition}
                onReliefPositionChange={onReliefPositionChange}
                embossHeight={embossHeight ?? [5]}
                embossSize={embossSize ?? [60]}
                reliefRotation={reliefRotation ?? 0}
              />
            </Suspense>
          </Canvas>
        </ErrorBoundary>
      </div>
    </div>
  )
}

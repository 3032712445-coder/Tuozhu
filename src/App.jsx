import { useState } from "react"
import { Layers, Download, Box } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PhoneModelSelector } from "@/components/phone-model-selector"
import { ImageInputArea } from "@/components/image-input-area"
import { EmbossParameters } from "@/components/emboss-parameters"
import { PreviewPanel } from "@/components/preview-panel"

export default function App() {
  const [phoneModel, setPhoneModel] = useState("")
  const [uploadedImage, setUploadedImage] = useState(null)
  const [aiPrompt, setAiPrompt] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)

  const [embossHeight, setEmbossHeight] = useState([5])
  const [embossSize, setEmbossSize] = useState([60])
  const [reliefRotation, setReliefRotation] = useState(0)
  const [isGenerated, setIsGenerated] = useState(false)
  const [isAdjustMode, setIsAdjustMode] = useState(false)
  const [reliefPosition, setReliefPosition] = useState({ x: 0, y: 0 })

  const handleAiGenerate = () => {
    setIsGenerating(true)
    setTimeout(() => {
      setIsGenerating(false)
    }, 2000)
  }

  const handleGenerate3D = () => {
    setIsGenerated(true)
  }

  const handleExport = () => {
    // placeholder for export logic
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top nav bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <Box className="size-4 text-primary" />
          </div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            3D 浮雕工坊
          </h1>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            BETA
          </span>
        </div>
        <p className="hidden text-xs text-muted-foreground md:block">
          手机壳浮雕定制工具
        </p>
      </header>

      {/* Main content area */}
      <main className="flex flex-1 flex-col lg:flex-row">
        {/* Left control panel */}
        <aside className="flex w-full flex-col border-b border-border/60 lg:w-[380px] lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
            {/* Phone model selector */}
            <PhoneModelSelector
              value={phoneModel}
              onValueChange={setPhoneModel}
            />

            {/* Separator */}
            <div className="h-px bg-border/40" />

            {/* Image input */}
            <ImageInputArea
              uploadedImage={uploadedImage}
              onImageUpload={setUploadedImage}
              aiPrompt={aiPrompt}
              onAiPromptChange={setAiPrompt}
              onAiGenerate={handleAiGenerate}
              isGenerating={isGenerating}
            />

            {/* Separator */}
            <div className="h-px bg-border/40" />

            {/* Emboss parameters */}
            <EmbossParameters
              height={embossHeight}
              size={embossSize}
              rotation={reliefRotation}
              onHeightChange={setEmbossHeight}
              onSizeChange={setEmbossSize}
              onRotationChange={setReliefRotation}
            />
          </div>

          {/* Bottom action buttons */}
          <div className="flex flex-col gap-2 border-t border-border/60 p-4">
            <Button
              onClick={handleGenerate3D}
              className="w-full"
              size="lg"
            >
              <Layers className="size-4" />
              生成 3D 浮雕
            </Button>
            <Button
              onClick={handleExport}
              variant="outline"
              className="w-full"
              size="lg"
            >
              <Download className="size-4" />
              导出打印模型 (STL/OBJ)
            </Button>
          </div>
        </aside>

        {/* Right preview panel */}
        <section className="flex flex-1 flex-col p-6">
          <PreviewPanel
            isGenerated={isGenerated}
            isAdjustMode={isAdjustMode}
            onAdjustModeToggle={() => setIsAdjustMode((v) => !v)}
            reliefPosition={reliefPosition}
            onReliefPositionChange={setReliefPosition}
            embossHeight={embossHeight}
            embossSize={embossSize}
            reliefRotation={reliefRotation}
          />
        </section>
      </main>
    </div>
  )
}

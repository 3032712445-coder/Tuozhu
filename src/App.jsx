import { useState } from "react"
import { Layers, Download, Box } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PhoneModelSelector } from "@/components/phone-model-selector"
import { ImageInputArea } from "@/components/image-input-area"
import { EmbossParameters } from "@/components/emboss-parameters"
import { PreviewPanel } from "@/components/preview-panel"
console.log("🔥 App.jsx in src running")
async function generateDepth(file) {

  if (!(file instanceof File)) {
    console.error("不是文件:", file)
    throw new Error("上传对象不是文件")
  }

  const formData = new FormData()
  formData.append("file", file)

  const res = await fetch("http://127.0.0.1:8000/depth", {
    method: "POST",
    body: formData
  })

  if (!res.ok) {
    const t = await res.text()
    console.log("后端错误:", t)
    throw new Error("生成失败")
  }

  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
export default function App() {
  const [phoneModel, setPhoneModel] = useState("")
  const [uploadedImage, setUploadedImage] = useState(null)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [depthUrl, setDepthUrl] = useState(null)
  const [aiPrompt, setAiPrompt] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDepthGenerating, setIsDepthGenerating] = useState(false)
  const [embossHeight, setEmbossHeight] = useState([5])
  const [embossSize, setEmbossSize] = useState([60])
  const [reliefRotation, setReliefRotation] = useState(0)
  const [depthVersion, setDepthVersion] = useState(0)
  const [isGenerated, setIsGenerated] = useState(false)
  const [isAdjustMode, setIsAdjustMode] = useState(false)
  const [reliefPosition, setReliefPosition] = useState({ x: 0, y: 0 })
  
  const handleAiGenerate = () => {
    setIsGenerating(true)
    setTimeout(() => {
      setIsGenerating(false)
    }, 2000)
  }

  const handleGenerate3D = async () => {
    console.log("开始生成")
    console.log("当前上传文件：", uploadedFile, uploadedFile instanceof File)

    if (!uploadedFile) {
    alert("请先上传图片")
    return
  }

  try {
    setIsDepthGenerating(true)

    const result = await generateDepth(uploadedFile)

    console.log("深度结果：", result)

    // TODO：这里后面接3D
    setDepthUrl(result)
    setDepthVersion(v => v + 1)
    setIsGenerated(true)

  } catch (err) {
    console.error(err)
    alert("生成失败")

  } finally {
    setIsDepthGenerating(false)
  }
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
              onImageUpload={(file, url) => {
              console.log("父组件收到 file:", file, file instanceof File)
              console.log("父组件收到 url:", url)

              setUploadedFile(file)
              setUploadedImage(url)
          }}
              aiPrompt={aiPrompt}
              onAiPromptChange={setAiPrompt}
              onAiGenerate={handleAiGenerate}
              isGenerating={isGenerating}
              isDepthGenerating={isDepthGenerating}
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
            depthVersion={depthVersion}
            depthUrl={depthUrl}
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

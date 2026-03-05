import { useState } from "react"
import { Layers, Download, Box } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PhoneModelSelector } from "@/components/phone-model-selector"
import { ImageInputArea } from "@/components/image-input-area"
import { EmbossParameters } from "@/components/emboss-parameters"
import { PreviewPanel } from "@/components/preview-panel"
import * as THREE from "three"
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js"
console.log("🔥 App.jsx in src running")

const PHONE_CASE_SPECS = {
  iphone15: { label: "iPhone15", width: 7.1, height: 14.7, thickness: 0.55 },
  iphone15pro: { label: "iPhone15Pro", width: 7.0, height: 14.6, thickness: 0.55 },
  xiaomi14: { label: "Xiaomi14", width: 7.2, height: 14.9, thickness: 0.55 },
  default: { label: "Generic", width: 7.0, height: 14.0, thickness: 0.5 },
}

function getCaseSpec(modelKey) {
  return PHONE_CASE_SPECS[modelKey] ?? PHONE_CASE_SPECS.default
}

function getEmbossScaleValue(embossHeight) {
  const height = Array.isArray(embossHeight) ? embossHeight[0] : embossHeight
  return (height / 10) * 5
}

function getReliefSizeScale(embossSize) {
  const sizeVal = Array.isArray(embossSize) ? embossSize[0] : embossSize
  return 0.3 + ((sizeVal - 20) / 180) * 2.2
}

function sampleGrayBilinear(pixels, width, height, u, v) {
  const x = u * (width - 1)
  const y = v * (height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = x - x0
  const ty = y - y0

  const idx00 = (y0 * width + x0) * 4
  const idx10 = (y0 * width + x1) * 4
  const idx01 = (y1 * width + x0) * 4
  const idx11 = (y1 * width + x1) * 4

  const p00 = pixels[idx00]
  const p10 = pixels[idx10]
  const p01 = pixels[idx01]
  const p11 = pixels[idx11]

  const top = p00 * (1 - tx) + p10 * tx
  const bottom = p01 * (1 - tx) + p11 * tx
  return (top * (1 - ty) + bottom * ty) / 255
}

async function loadDepthImageData(depthMapUrl) {
  const image = new Image()
  image.crossOrigin = "anonymous"

  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error("深度图加载失败，无法导出 STL"))
    image.src = depthMapUrl
  })

  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) {
    throw new Error("浏览器无法读取 Canvas 2D 上下文")
  }

  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return {
    pixels: data,
    width: canvas.width,
    height: canvas.height,
  }
}

function buildEmbossedCaseMesh({
  phoneModel,
  embossHeight,
  embossSize,
  reliefRotation,
  reliefPosition,
  depthPixels,
  depthWidth,
  depthHeight,
}) {
  const spec = getCaseSpec(phoneModel)
  const depthAspect = depthWidth / depthHeight
  const reliefScale = getReliefSizeScale(embossSize)
  const reliefHeightInScene = 7 * reliefScale
  const reliefWidthInScene = 7 * depthAspect * reliefScale
  const maxEmbossHeight = getEmbossScaleValue(embossHeight)
  const rot = (reliefRotation * Math.PI) / 180
  const cosR = Math.cos(-rot)
  const sinR = Math.sin(-rot)

  // 背面导出用较高分段，确保顶点位移不出现明显马赛克。
  const geometry = new THREE.BoxGeometry(
    spec.width,
    spec.thickness,
    spec.height,
    220,
    1,
    420
  ).toNonIndexed()

  const positionAttr = geometry.getAttribute("position")
  const normalAttr = geometry.getAttribute("normal")

  for (let i = 0; i < positionAttr.count; i += 1) {
    const nx = normalAttr.getX(i)
    const ny = normalAttr.getY(i)
    const nz = normalAttr.getZ(i)

    // 只处理背面(法线朝 +Y)顶点，避免影响侧边和内部。
    if (ny < 0.99 || Math.abs(nx) > 1e-4 || Math.abs(nz) > 1e-4) {
      continue
    }

    const worldX = positionAttr.getX(i)
    const worldZ = positionAttr.getZ(i)
    const dx = worldX - reliefPosition.x
    const dz = worldZ - reliefPosition.y

    const localX = dx * cosR - dz * sinR
    const localZ = dx * sinR + dz * cosR

    const u = localX / reliefWidthInScene + 0.5
    const v = 0.5 - localZ / reliefHeightInScene

    if (u < 0 || u > 1 || v < 0 || v > 1) {
      continue
    }

    const depth = sampleGrayBilinear(depthPixels, depthWidth, depthHeight, u, v)
    const displacedY = spec.thickness / 2 + depth * maxEmbossHeight
    positionAttr.setY(i, displacedY)
  }

  positionAttr.needsUpdate = true
  geometry.computeVertexNormals()

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: "#cccccc" })
  )
  return mesh
}

function triggerStlDownload(stlText, phoneModel) {
  const caseSpec = getCaseSpec(phoneModel)
  const fileName = `Tuozhu_Custom_Case_${caseSpec.label}.stl`
  const blob = new Blob([stlText], { type: "model/stl" })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(objectUrl)
}

async function generateDepth(file) {

  if (!(file instanceof File)) {
    console.error("不是文件:", file)
    throw new Error("上传对象不是文件")
  }

  const formData = new FormData()
  formData.append("file", file)

  const res = await fetch("http://127.0.0.1:8001/depth", {
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
async function generateImage(prompt) {
  const res = await fetch("http://127.0.0.1:8000/generate-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  })
  if (!res.ok) {
    const t = await res.text()
    console.log("智谱后端错误:", t)
    throw new Error("AI 生成失败")
  }
  const data = await res.json()
  return data.image_url
}
async function generateDepthByUrl(imageUrl) {
  const res = await fetch("http://127.0.0.1:8001/depth/by-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ image_url: imageUrl }),
  })
  if (!res.ok) {
    const t = await res.text()
    console.log("深度服务错误:", t)
    throw new Error("深度生成失败")
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
  
  const handleAiGenerate = async () => {
    try {
      setIsGenerating(true)
      console.log("开始 AI 生成，prompt:", aiPrompt)
      const imageUrl = await generateImage(aiPrompt || "")
      console.log("AI 生成图片 URL:", imageUrl)
      setUploadedImage(imageUrl)
      setUploadedFile(null)
      setIsDepthGenerating(true)
      const depthObjUrl = await generateDepthByUrl(imageUrl)
      setDepthUrl(depthObjUrl)
      setDepthVersion(v => v + 1)
      setIsGenerated(true)
    } catch (err) {
      console.error(err)
      alert("AI 生成或深度生成失败")
    } finally {
      setIsGenerating(false)
      setIsDepthGenerating(false)
    }
  }

  const handleGenerate3D = async () => {
    console.log("开始生成")
    console.log("当前上传文件：", uploadedFile, uploadedFile instanceof File)

    try {
      setIsDepthGenerating(true)
      // 本地文件路径：上传文件走 /depth
      if (uploadedFile instanceof File) {
        const result = await generateDepth(uploadedFile)
        console.log("深度结果(本地文件)：", result)
        setDepthUrl(result)
        setDepthVersion(v => v + 1)
        setIsGenerated(true)
        return
      }
      // AI 图片路径：远程 URL 走 /depth/by-url
      if (uploadedImage && /^https?:\/\//.test(uploadedImage)) {
        const result = await generateDepthByUrl(uploadedImage)
        console.log("深度结果(AI 图片 URL)：", result)
        setDepthUrl(result)
        setDepthVersion(v => v + 1)
        setIsGenerated(true)
        return
      }
      alert("请先上传图片或使用 AI 生成图片")
    } catch (err) {
      console.error(err)
      alert("生成失败")
    } finally {
      setIsDepthGenerating(false)
    }
  }

  const handleExportSTL = async () => {
    if (!depthUrl) {
      alert("请先生成深度图后再导出 STL")
      return
    }

    try {
      const { pixels, width, height } = await loadDepthImageData(depthUrl)

      const embossedMesh = buildEmbossedCaseMesh({
        phoneModel,
        embossHeight,
        embossSize,
        reliefRotation,
        reliefPosition,
        depthPixels: pixels,
        depthWidth: width,
        depthHeight: height,
      })

      const exporter = new STLExporter()
      const stlText = exporter.parse(embossedMesh)
      triggerStlDownload(stlText, phoneModel)

      embossedMesh.geometry.dispose()
      embossedMesh.material.dispose()
    } catch (error) {
      console.error("导出 STL 失败:", error)
      alert("导出 STL 失败，请检查深度图是否可用")
    }
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
              onClick={handleExportSTL}
              variant="outline"
              className="w-full"
              size="lg"
            >
              <Download className="size-4" />
              导出打印模型 (STL)
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

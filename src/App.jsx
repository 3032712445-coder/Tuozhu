import { useState } from "react"
import { Layers, Download, Box } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PhoneModelSelector } from "@/components/phone-model-selector"
import { ImageInputArea } from "@/components/image-input-area"
import { EmbossParameters } from "@/components/emboss-parameters"
import { PreviewPanel } from "@/components/preview-panel"
import * as THREE from "three"
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js"

console.log("🔥 App.jsx in src running")

const DEFAULT_PHONE_W = 7
const DEFAULT_PHONE_H = 14
const IPHONE16_MASK_CONFIG = {
  scaleX: 1.40,
  scaleY: 1.05,
  offsetX: 0.0,
  offsetY: 0.0,
  translateX: 0.15,
  translateY: -0.15,
  flipX: false,
  flipY: false,
  rotDeg: 0.0
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
  // 防御性检查
  if (!pixels || width <= 0 || height <= 0) return 0.0
  if (!Number.isFinite(u) || !Number.isFinite(v)) return 0.0

  const x = Math.max(0, Math.min(width - 1, u * (width - 1)))
  const y = Math.max(0, Math.min(height - 1, v * (height - 1)))
  
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

  // 确保索引不越界（虽然上面的 min/max 应该保证了）
  if (idx11 >= pixels.length) return 0.0

  const p00 = pixels[idx00] || 0
  const p10 = pixels[idx10] || 0
  const p01 = pixels[idx01] || 0
  const p11 = pixels[idx11] || 0

  const top = p00 * (1 - tx) + p10 * tx
  const bottom = p01 * (1 - tx) + p11 * tx
  const val = (top * (1 - ty) + bottom * ty) / 255
  
  return Number.isFinite(val) ? val : 0.0
}

async function loadDepthImageData(depthMapUrl) {
  const image = new Image()
  image.crossOrigin = "anonymous"

  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = (e) => {
      console.error("Depth map load error:", e)
      reject(new Error(`深度图加载失败，路径: ${depthMapUrl}`))
    }
    // 处理相对路径
    if (depthMapUrl.startsWith("/")) {
      image.src = depthMapUrl
    } else {
      image.src = depthMapUrl
    }
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

// 加载掩模图片并返回像素数据
async function loadMaskData(model) {
  const path = `/phonecase/${model}.png`
  try {
    const image = new Image()
    image.crossOrigin = "anonymous"
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = path
    })
    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext("2d")
    ctx.drawImage(image, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { pixels: data, width, height }
  } catch (e) {
    console.warn("Mask load failed, fallback to no mask", e)
    return null
  }
}

async function loadAndPrepareSTL(phoneModel) {
  const loader = new STLLoader()
  const geometry = await new Promise((resolve, reject) => {
    loader.load(
      `/phonecase/${phoneModel}.stl`,
      (geo) => resolve(geo),
      undefined,
      (err) => reject(err)
    )
  })

  // 1. 旋转与缩放（复用 Scene3D 中的逻辑）
  geometry.rotateX(Math.PI / 2)
  geometry.computeBoundingBox()
  const size0 = new THREE.Vector3()
  geometry.boundingBox.getSize(size0)
  
  const targetW = DEFAULT_PHONE_W
  const targetH = DEFAULT_PHONE_H
  const scaleFactor = Math.min(targetW / (size0.x || 1), targetH / (size0.z || 1))
  geometry.scale(scaleFactor, scaleFactor, scaleFactor)
  
  // 2. 居中与归零
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const center = new THREE.Vector3()
  bb.getCenter(center)
  const topY = bb.max.y
  // 将模型移动到 (0, 0, 0) 为中心，且最高点为 Y=0
  geometry.translate(-center.x, -topY, -center.z)
  
  // 确保有 normal 属性
  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals()
  }

  return geometry
}

// 检查点是否在掩模的非法区域（孔洞）
function isPointInMask(x, z, maskData, caseWidth, caseHeight) {
  if (!maskData) return false // 无掩模则认为全部合法
  
  // 1. 将世界坐标 (x, z) 转换为相对于中心 (0,0) 的局部坐标
  // 此时 x, z 已经是相对于手机壳中心的坐标
  
  // 2. 应用平移（逆向操作）
  let wx = x - IPHONE16_MASK_CONFIG.translateX
  let wy = z - IPHONE16_MASK_CONFIG.translateY // 注意：3D中的z对应2D中的y
  
  // 3. 应用旋转（逆向操作）
  const rot = IPHONE16_MASK_CONFIG.rotDeg * Math.PI / 180
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const rx = wx * c - wy * s
  const ry = wx * s + wy * c
  
  // 4. 归一化到 UV [0, 1]
  let u = rx / (caseWidth * IPHONE16_MASK_CONFIG.scaleX) + 0.5
  let v = ry / (caseHeight * IPHONE16_MASK_CONFIG.scaleY) + 0.5
  
  // 5. 应用镜像
  if (IPHONE16_MASK_CONFIG.flipX) u = 1.0 - u
  if (IPHONE16_MASK_CONFIG.flipY) v = 1.0 - v
  
  // 6. 应用偏移（减法，与 Shader 一致）
  u = u - IPHONE16_MASK_CONFIG.offsetX
  v = v - IPHONE16_MASK_CONFIG.offsetY
  
  // 7. 采样掩模
  if (u < 0 || u > 1 || v < 0 || v > 1) return true // 超出掩模范围视为非法
  
  const tx = Math.floor(u * (maskData.width - 1))
  const ty = Math.floor(v * (maskData.height - 1))
  const idx = (ty * maskData.width + tx) * 4
  const val = maskData.pixels[idx] // R通道
  
  // 黑色(0) = 合法, 白色(255) = 孔洞
  return val > 128
}

async function buildCombinedMesh({
  phoneModel,
  embossHeight,
  embossSize,
  reliefRotation,
  reliefPosition,
  depthPixels,
  depthWidth,
  depthHeight,
}) {
  console.log("Start buildCombinedMesh", { phoneModel })
  
  // 1. 加载手机壳基底模型
  let caseGeometry
  try {
    caseGeometry = await loadAndPrepareSTL(phoneModel)
    console.log("Loaded case geometry", caseGeometry)
  } catch (e) {
    console.error("Failed to load STL", e)
    throw new Error("手机壳模型加载失败")
  }
  
  // 获取手机壳尺寸
  caseGeometry.computeBoundingBox()
  const caseSize = new THREE.Vector3()
  caseGeometry.boundingBox.getSize(caseSize)
  const caseWidth = caseSize.x
  const caseHeight = caseSize.z
  
  // 2. 加载掩模数据
  const maskData = await loadMaskData(phoneModel)
  
  // 3. 生成浮雕几何体
  const depthAspect = depthWidth / depthHeight
  const reliefScale = getReliefSizeScale(embossSize)
  const reliefHeightInScene = 7 * reliefScale
  const reliefWidthInScene = 7 * depthAspect * reliefScale
  const maxEmbossHeight = getEmbossScaleValue(embossHeight)
  const rot = (reliefRotation * Math.PI) / 180
  const cosR = Math.cos(-rot)
  const sinR = Math.sin(-rot)

  // 前置检查
  if (!depthPixels || depthPixels.length === 0) throw new Error("深度图数据为空")
  if (reliefWidthInScene <= 0.001 || reliefHeightInScene <= 0.001) throw new Error("浮雕尺寸无效")

  // 使用高细分平面作为浮雕
  // 细分度取决于浮雕尺寸，确保精度
  // 提升到 800 以获得超高精度（接近 100万个面），适合精细打印
  const segW = Math.floor(800 * reliefScale)
  const segH = Math.floor(800 * reliefScale * depthAspect)
  const reliefGeo = new THREE.PlaneGeometry(reliefWidthInScene, reliefHeightInScene, segW, segH)
  
  // 4. 应用置换与裁剪
  const posAttr = reliefGeo.getAttribute("position")
  const vertexDisplacements = new Float32Array(posAttr.count)
  
  for (let i = 0; i < posAttr.count; i++) {
    const lx = posAttr.getX(i) 
    const ly = posAttr.getY(i) 
    
    // UV 映射修正：
    // 为了配合后续的几何体 180 度旋转 (rotateY(Math.PI))：
    // 1. 垂直方向 (V)：
    //    Geometry Y 180 旋转会将 -Z (原 Top) 变为 +Z (现 Top)。
    //    这已经将几何体 Top 对齐到了 Phone Top (+Z)。
    //    所以我们只需要标准的 V 映射 (Image Top -> Geometry Top)。
    //    v = ly / height + 0.5
    // 2. 水平方向 (U)：
    //    Geometry Y 180 旋转会将 +X (原 Right) 变为 -X (现 Left)。
    //    这意味着 Geometry 的右侧会出现在 Phone 的左侧。
    //    我们需要 Image Left (u=0) 出现在 Phone Left (-X)。
    //    即我们需要将 Image Left 映射到 Geometry Right。
    //    所以 U 需要反转。
    
    const u = 1.0 - (lx / reliefWidthInScene + 0.5) // 反转 U
    const v = (ly / reliefHeightInScene + 0.5)      // 标准 V
    
    const depth = sampleGrayBilinear(depthPixels, depthWidth, depthHeight, u, v)
    let displacement = depth * maxEmbossHeight
    
    // NaN 检查与修复
    if (!Number.isFinite(displacement)) {
      displacement = 0
    }

    // 阈值过滤：消除底噪，确保黑色区域完全贴合
    if (displacement < 0.05) displacement = 0

    posAttr.setZ(i, displacement)
    vertexDisplacements[i] = displacement // 记录原始置换值用于后续剔除
    
    // 世界坐标计算修正（与 UV 修正对应）
    const wx_rot = lx * cosR - ly * sinR
    const wz_rot = lx * sinR + ly * cosR
    const wx = wx_rot + reliefPosition.x
    const wz = wz_rot + reliefPosition.y
    
    // 坐标 NaN 检查
    if (!Number.isFinite(wx) || !Number.isFinite(wz)) {
      posAttr.setZ(i, 0)
      vertexDisplacements[i] = 0
      continue
    }

    const halfW = caseWidth / 2
    const halfH = caseHeight / 2
    const isOutsideCase = Math.abs(wx) > halfW || Math.abs(wz) > halfH
    
    const isHole = isPointInMask(wx, wz, maskData, caseWidth, caseHeight)
    
    if (isOutsideCase || isHole) {
       posAttr.setZ(i, 0)
       vertexDisplacements[i] = 0
    }
  }
  
  // --- 剔除高度为 0 的无效面 (Face Culling) ---
  // PlaneGeometry 默认是有索引的 (indexed geometry)
  // 我们需要遍历索引，检查每个三角形的三个顶点
  // 如果三个顶点的高度都为 0，则说明该面在底面上，可以剔除
  
  const indexAttr = reliefGeo.getIndex()
  if (!indexAttr) {
    throw new Error("PlaneGeometry 应该有索引")
  }
  
  const indices = indexAttr.array
  const newIndices = []
  
  // 遍历所有三角形
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]
    const b = indices[i + 1]
    const c = indices[i + 2]
    
    // 检查这三个顶点的置换高度
    const dispA = vertexDisplacements[a]
    const dispB = vertexDisplacements[b]
    const dispC = vertexDisplacements[c]
    
    // 如果任意一个顶点有高度 > 0，则保留该面
    // 只有当三个点全为 0 时才剔除
    if (dispA > 0.001 || dispB > 0.001 || dispC > 0.001) {
      newIndices.push(a, b, c)
    }
  }
  
  // 更新索引缓冲区
  reliefGeo.setIndex(newIndices)
  
  // 清理未使用的顶点（可选，BufferGeometryUtils.mergeVertices 可以做，但这里只要面没了就行）
  // 为了确保导出干净，我们可以不清理顶点，因为 STLExporter 只关心面
  
  posAttr.needsUpdate = true
  reliefGeo.computeBoundingBox() 
  reliefGeo.computeVertexNormals()
  
  // 旋转修正：
  reliefGeo.rotateX(-Math.PI / 2)
  reliefGeo.rotateY(-rot + Math.PI) 
  
  // 镜像修正：仅对浮雕进行 X 轴镜像
  // 因为 UV 翻转和旋转可能导致了左右颠倒，这里单独修正浮雕
  reliefGeo.scale(-1, 1, 1)
  reliefGeo.computeVertexNormals() // 镜像后重算法线
  
  reliefGeo.translate(reliefPosition.x, 0, reliefPosition.y)
  
  // 强制更新世界矩阵（虽然 geometry 变换是直接改顶点，但安全起见）
  reliefGeo.computeBoundingBox()
  
  // 5. 合并几何体
  const caseGeoNonIndexed = caseGeometry.toNonIndexed()
  // 注意：reliefGeo 现在可能还是 indexed 的（因为我们只改了 index buffer）
  // 为了与 caseGeo 合并，我们需要转为 non-indexed
  const reliefGeoNonIndexed = reliefGeo.toNonIndexed()

  // 移除冲突属性
  const attributesToRemove = ['morphPosition', 'morphNormal', 'uv2', 'color', 'skinIndex', 'skinWeight']
  attributesToRemove.forEach(attr => {
    caseGeoNonIndexed.deleteAttribute(attr)
    reliefGeoNonIndexed.deleteAttribute(attr)
  })
  
  // 确保 morphAttributes 存在
  if (!caseGeoNonIndexed.morphAttributes) caseGeoNonIndexed.morphAttributes = {}
  if (!reliefGeoNonIndexed.morphAttributes) reliefGeoNonIndexed.morphAttributes = {}

  // 强制统一 uv 属性
  if (!caseGeoNonIndexed.getAttribute('uv')) {
    const count = caseGeoNonIndexed.getAttribute('position').count
    const uvs = new Float32Array(count * 2)
    caseGeoNonIndexed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  }
  if (!reliefGeoNonIndexed.getAttribute('uv')) {
    const count = reliefGeoNonIndexed.getAttribute('position').count
    const uvs = new Float32Array(count * 2)
    reliefGeoNonIndexed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  }

  // 重新计算法线，确保方向正确
  caseGeoNonIndexed.computeVertexNormals()
  reliefGeoNonIndexed.computeVertexNormals()

  console.log("Merging geometries...", {
    case: {
      count: caseGeoNonIndexed.getAttribute('position').count,
      attrs: Object.keys(caseGeoNonIndexed.attributes)
    },
    relief: {
      count: reliefGeoNonIndexed.getAttribute('position').count,
      attrs: Object.keys(reliefGeoNonIndexed.attributes)
    }
  })
  
  let mergedGeo = BufferGeometryUtils.mergeGeometries([caseGeoNonIndexed, reliefGeoNonIndexed], false)
  
  if (!mergedGeo) {
    console.error("Merge failed, returning case geometry only")
    return new THREE.Mesh(caseGeoNonIndexed, new THREE.MeshStandardMaterial({ color: "#cccccc" }))
  }

  // --- 导出前标准化流程 ---
  
  // 1. 强制居中 (Center)
  mergedGeo.computeBoundingBox()
  mergedGeo.center()

  // 2. 统一缩放 (Scale) 到毫米单位
  // 先检查当前尺寸
  mergedGeo.computeBoundingBox()
  const currentSize = new THREE.Vector3()
  mergedGeo.boundingBox.getSize(currentSize)
  
  // 如果宽度小于 10 (大概率是 cm 或 m)，强制放大到 70-80mm 左右
  let scaleFactor = 1.0
  if (currentSize.x < 10.0) {
    scaleFactor = 75.0 / currentSize.x
    console.log(`Auto-scaling mesh by factor ${scaleFactor} to match mm units`)
    mergedGeo.scale(scaleFactor, scaleFactor, scaleFactor)
  }
  
  // 3. 贴地处理 (Floor Alignment)
  // 缩放后重新计算包围盒
  mergedGeo.computeBoundingBox()
  const minY = mergedGeo.boundingBox.min.y
  mergedGeo.translate(0, -minY, 0) // 底部对齐 Y=0

  // 4. 法线重算 (Recompute Normals)
  mergedGeo.computeVertexNormals()

  // 5. 打印最终状态
  mergedGeo.computeBoundingBox()
  const finalBB = mergedGeo.boundingBox
  const finalSize = new THREE.Vector3()
  finalBB.getSize(finalSize)
  console.log("Final standardized mesh:", {
    size: finalSize,
    min: finalBB.min,
    max: finalBB.max,
    vertexCount: mergedGeo.getAttribute('position').count
  })

  if (!mergedGeo.morphAttributes) mergedGeo.morphAttributes = {}

  const mesh = new THREE.Mesh(
    mergedGeo,
    new THREE.MeshStandardMaterial({ color: "#cccccc", side: THREE.DoubleSide })
  )
  
  // 6. 强制更新世界矩阵
  mesh.updateMatrixWorld(true)
  
  return mesh
}

function triggerStlDownload(stlText, phoneModel) {
  const fileName = `Tuozhu_Custom_Case_${phoneModel || "iphone16"}.stl`
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

  console.log("正在发送深度图生成请求...", file.name)
  const res = await fetch("http://127.0.0.1:8001/depth", {
    method: "POST",
    body: formData
  })
  console.log("深度图请求已发送，状态码:", res.status)

  if (!res.ok) {
    const t = await res.text()
    console.log("后端错误:", t)
    throw new Error("生成失败")
  }

  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

async function generateImage(prompt) {
  console.log("正在发送 AI 生图请求...", prompt)
  const res = await fetch("http://127.0.0.1:8000/generate-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  })
  console.log("AI 生图请求已发送，状态码:", res.status)
  
  if (!res.ok) {
    const t = await res.text()
    console.log("智谱后端错误:", t)
    throw new Error(`AI 生成失败: ${t}`)
  }
  const data = await res.json()
  return data.image_url
}

async function generateDepthByUrl(imageUrl) {
  console.log("正在发送 URL 深度图生成请求...", imageUrl)
  const res = await fetch("http://127.0.0.1:8001/depth/by-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ image_url: imageUrl }),
  })
  console.log("URL 深度图请求已发送，状态码:", res.status)

  if (!res.ok) {
    const t = await res.text()
    console.log("深度服务错误:", t)
    throw new Error(`深度生成失败: ${t}`)
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
      alert(`AI 生成或深度生成失败: ${err.message}`)
    } finally {
      setIsGenerating(false)
      setIsDepthGenerating(false)
    }
  }

  const handleGenerate3D = async () => {
    console.log("开始生成")
    try {
      setIsDepthGenerating(true)
      if (!uploadedFile && !uploadedImage) {
        setDepthUrl("/test-depth.jpg")
        setDepthVersion(v => v + 1)
        setIsGenerated(true)
        alert("未选择图片，已为您生成默认浮雕")
        return
      }
      if (uploadedFile instanceof File) {
        const result = await generateDepth(uploadedFile)
        setDepthUrl(result)
        setDepthVersion(v => v + 1)
        setIsGenerated(true)
        return
      }
      if (uploadedImage && /^https?:\/\//.test(uploadedImage)) {
        const result = await generateDepthByUrl(uploadedImage)
        setDepthUrl(result)
        setDepthVersion(v => v + 1)
        setIsGenerated(true)
        return
      }
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
    const currentModel = phoneModel || "iphone16" // 默认回退到 iphone16
    try {
      let pixels, width, height

      // Check if there is a modified canvas from eraser tool
      if (window.__eraserCanvas) {
        console.log("Using modified depth map from eraser canvas")
        const canvas = window.__eraserCanvas
        width = canvas.width
        height = canvas.height
        const ctx = canvas.getContext("2d")
        pixels = ctx.getImageData(0, 0, width, height).data
      } else {
        const data = await loadDepthImageData(depthUrl)
        pixels = data.pixels
        width = data.width
        height = data.height
      }

      const embossedMesh = await buildCombinedMesh({
        phoneModel: currentModel,
        embossHeight,
        embossSize,
        reliefRotation,
        reliefPosition,
        depthPixels: pixels,
        depthWidth: width,
        depthHeight: height,
      })
      const exporter = new STLExporter()
      const stlText = exporter.parse(embossedMesh, { binary: true })
      triggerStlDownload(stlText, currentModel)
      embossedMesh.geometry.dispose()
      embossedMesh.material.dispose()
    } catch (error) {
      console.error("导出 STL 失败:", error)
      alert(`导出 STL 失败: ${error.message}`)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
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

      <main className="flex flex-1 flex-col lg:flex-row">
        <aside className="flex w-full flex-col border-b border-border/60 lg:w-[380px] lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
            <PhoneModelSelector
              value={phoneModel}
              onValueChange={setPhoneModel}
            />
            <div className="h-px bg-border/40" />
            <ImageInputArea
              uploadedImage={uploadedImage}
              onImageUpload={(file, url) => {
                setUploadedFile(file)
                setUploadedImage(url)
              }}
              aiPrompt={aiPrompt}
              onAiPromptChange={setAiPrompt}
              onAiGenerate={handleAiGenerate}
              isGenerating={isGenerating}
              isDepthGenerating={isDepthGenerating}
            />
            <div className="h-px bg-border/40" />
            <EmbossParameters
              height={embossHeight}
              size={embossSize}
              rotation={reliefRotation}
              onHeightChange={setEmbossHeight}
              onSizeChange={setEmbossSize}
              onRotationChange={setReliefRotation}
            />
          </div>

          <div className="flex flex-col gap-2 border-t border-border/60 p-4">
            <Button onClick={handleGenerate3D} className="w-full" size="lg">
              <Layers className="size-4" />
              生成 3D 浮雕
            </Button>
            <Button onClick={handleExportSTL} variant="outline" className="w-full" size="lg">
              <Download className="size-4" />
              导出打印模型 (STL)
            </Button>
          </div>
        </aside>

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
            phoneModel={phoneModel}
          />
        </section>
      </main>
    </div>
  )
}

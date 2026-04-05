import { useState, useEffect } from "react"
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

// 边缘柔化处理函数
function softenEdges(pixels, width, height) {
  // 创建一个新的像素数组，避免直接修改原数据
  const newData = new Uint8ClampedArray(pixels.length)
  
  // 复制原始数据
  for (let i = 0; i < pixels.length; i++) {
    newData[i] = pixels[i]
  }
  
  // 定义更大的邻域范围（16个方向，包括更远的像素）
  const offsets = [
    [-2, -2], [-2, -1], [-2, 0], [-2, 1], [-2, 2],
    [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2],
    [0, -2],  [0, -1],           [0, 1],  [0, 2],
    [1, -2],  [1, -1],  [1, 0],  [1, 1],  [1, 2],
    [2, -2],  [2, -1],  [2, 0],  [2, 1],  [2, 2]
  ]
  
  // 遍历每个像素
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = (y * width + x) * 4
      const currentValue = pixels[idx]
      
      // 检查当前像素是否为边缘像素
      // 边缘像素的定义：当前像素值为0，周围有非零像素；或者当前像素值非零，周围有0像素
      let hasZeroNeighbor = false
      let hasNonZeroNeighbor = false
      
      for (const [dx, dy] of offsets) {
        const nx = x + dx
        const ny = y + dy
        const nIdx = (ny * width + nx) * 4
        const neighborValue = pixels[nIdx]
        
        if (neighborValue === 0) {
          hasZeroNeighbor = true
        } else {
          hasNonZeroNeighbor = true
        }
      }
      
      // 如果是边缘像素（一侧为0，一侧有高度）
      if (hasZeroNeighbor && hasNonZeroNeighbor) {
        // 计算周围非零像素的加权平均值，距离越近权重越大
        let sum = 0
        let totalWeight = 0
        
        for (const [dx, dy] of offsets) {
          const nx = x + dx
          const ny = y + dy
          const nIdx = (ny * width + nx) * 4
          const neighborValue = pixels[nIdx]
          
          if (neighborValue > 0) {
            // 计算距离权重，距离越近权重越大
            const distance = Math.sqrt(dx * dx + dy * dy)
            const weight = 1 / (distance + 1) // 避免除以0
            sum += neighborValue * weight
            totalWeight += weight
          }
        }
        
        if (totalWeight > 0) {
          const weightedAvg = Math.round(sum / totalWeight)
          // 对于边缘像素，使用加权平均值进行柔化
          newData[idx] = weightedAvg // R通道
          newData[idx + 1] = weightedAvg // G通道
          newData[idx + 2] = weightedAvg // B通道
        }
      }
    }
  }
  
  // 进行第二次迭代，进一步柔化边缘
  const secondPass = new Uint8ClampedArray(newData.length)
  for (let i = 0; i < newData.length; i++) {
    secondPass[i] = newData[i]
  }
  
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = (y * width + x) * 4
      const currentValue = newData[idx]
      
      // 检查当前像素是否为边缘像素
      let hasZeroNeighbor = false
      let hasNonZeroNeighbor = false
      
      for (const [dx, dy] of offsets) {
        const nx = x + dx
        const ny = y + dy
        const nIdx = (ny * width + nx) * 4
        const neighborValue = newData[nIdx]
        
        if (neighborValue === 0) {
          hasZeroNeighbor = true
        } else {
          hasNonZeroNeighbor = true
        }
      }
      
      // 如果是边缘像素，再次进行柔化
      if (hasZeroNeighbor && hasNonZeroNeighbor) {
        let sum = 0
        let totalWeight = 0
        
        for (const [dx, dy] of offsets) {
          const nx = x + dx
          const ny = y + dy
          const nIdx = (ny * width + nx) * 4
          const neighborValue = newData[nIdx]
          
          if (neighborValue > 0) {
            const distance = Math.sqrt(dx * dx + dy * dy)
            const weight = 1 / (distance + 1)
            sum += neighborValue * weight
            totalWeight += weight
          }
        }
        
        if (totalWeight > 0) {
          const weightedAvg = Math.round(sum / totalWeight)
          secondPass[idx] = weightedAvg
          secondPass[idx + 1] = weightedAvg
          secondPass[idx + 2] = weightedAvg
        }
      }
    }
  }
  
  return secondPass
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
  let { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  
  // 边缘柔化处理
  data = softenEdges(data, canvas.width, canvas.height)
  
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
  
  // 内存清理函数
  const cleanup = () => {
    if (typeof caseGeometry !== 'undefined' && caseGeometry) {
      caseGeometry.dispose()
    }
    if (typeof reliefGeo !== 'undefined' && reliefGeo) {
      reliefGeo.dispose()
    }
    if (typeof caseGeoNonIndexed !== 'undefined' && caseGeoNonIndexed) {
      caseGeoNonIndexed.dispose()
    }
    if (typeof reliefGeoNonIndexed !== 'undefined' && reliefGeoNonIndexed) {
      reliefGeoNonIndexed.dispose()
    }
    if (typeof mergedGeo !== 'undefined' && mergedGeo) {
      mergedGeo.dispose()
    }
  }
  
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
  
  // 3. 生成浮雕几何体 (采用水密包裹算法 Watertight Algorithm)
  const depthAspect = depthWidth / depthHeight
  const reliefScale = getReliefSizeScale(embossSize)
  const reliefHeightInScene = 7 * reliefScale
  const reliefWidthInScene = 7 * depthAspect * reliefScale
  const maxEmbossHeight = getEmbossScaleValue(embossHeight)
  const rot = (reliefRotation * Math.PI) / 180
  const cosR = Math.cos(-rot)
  const sinR = Math.sin(-rot)
  
  const bottomOffset = -0.01 // 只嵌入0.01mm，让浮雕底面正好与手机壳背面接触
  const baseZ = bottomOffset // 保持底面与手机壳接触

  if (!depthPixels || depthPixels.length === 0) throw new Error("深度图数据为空")

  const baseSegments = 512
  const segW = Math.floor(baseSegments * reliefScale)
  const segH = Math.floor(baseSegments * reliefScale * depthAspect)
  
  console.log(`Creating watertight relief with segments: ${segW}x${segH}`)
  
  // 使用 PlaneGeometry 作为基础顶点源
  const reliefGeoRaw = new THREE.PlaneGeometry(reliefWidthInScene, reliefHeightInScene, segW, segH)
  const posAttrRaw = reliefGeoRaw.getAttribute("position")
  const indexAttrRaw = reliefGeoRaw.getIndex()

  // 记录顶点的有效性和高度
  const vertexValid = new Uint8Array(posAttrRaw.count)
  const vertexDisp = new Float32Array(posAttrRaw.count)

  for (let i = 0; i < posAttrRaw.count; i++) {
    const lx = posAttrRaw.getX(i)
    const ly = posAttrRaw.getY(i)

    const u = (lx / reliefWidthInScene + 0.5)
    const v = (ly / reliefHeightInScene + 0.5)

    const depth = sampleGrayBilinear(depthPixels, depthWidth, depthHeight, u, v)
    let displacement = depth * maxEmbossHeight
    if (!Number.isFinite(displacement)) displacement = 0
    if (displacement < 0.05) displacement = 0 // 去除底噪

    const wx_rot = lx * cosR - ly * sinR
    const wz_rot = lx * sinR + ly * cosR
    const wx = wx_rot + reliefPosition.x
    const wz = wz_rot + reliefPosition.y

    const halfW = caseWidth / 2
    const halfH = caseHeight / 2
    const isOutsideCase = Math.abs(wx) > halfW || Math.abs(wz) > halfH
    const isHole = isPointInMask(wx, wz, maskData, caseWidth, caseHeight)

    if (isOutsideCase || isHole) {
      vertexValid[i] = 0
      vertexDisp[i] = 0
    } else {
      vertexValid[i] = 1
      vertexDisp[i] = displacement
    }
  }

  const rawIndices = indexAttrRaw.array
  const keptFaces =[]

  // 筛选出合法的面
  for (let i = 0; i < rawIndices.length; i += 3) {
    const a = rawIndices[i]
    const b = rawIndices[i+1]
    const c = rawIndices[i+2]

    const allValid = vertexValid[a] && vertexValid[b] && vertexValid[c]
    const hasDisp = vertexDisp[a] > 0 || vertexDisp[b] > 0 || vertexDisp[c] > 0

    if (allValid && hasDisp) {
      keptFaces.push(a, b, c)
    }
  }

  // 构建独立顶点池
  const vertexMap = new Int32Array(posAttrRaw.count).fill(-1)
  let keptVertexCount = 0
  const topVertices =[]
  const uvsRaw = reliefGeoRaw.getAttribute("uv")
  const topUvs =[]

  for (let i = 0; i < keptFaces.length; i++) {
    const rawIdx = keptFaces[i]
    if (vertexMap[rawIdx] === -1) {
      vertexMap[rawIdx] = keptVertexCount
      topVertices.push(
        posAttrRaw.getX(rawIdx),
        posAttrRaw.getY(rawIdx),
        vertexDisp[rawIdx] + bottomOffset
      )
      topUvs.push(uvsRaw.getX(rawIdx), uvsRaw.getY(rawIdx))
      keptVertexCount++
    }
  }

  // 复制顶点作为底面，缝合顶底
  const finalVertices = new Float32Array(keptVertexCount * 3 * 2)
  const bottomVertices =[]
  for(let i=0; i<keptVertexCount; i++) {
    bottomVertices.push(topVertices[i*3], topVertices[i*3+1], baseZ)
  }
  finalVertices.set(topVertices, 0)
  finalVertices.set(bottomVertices, keptVertexCount * 3)

  const finalUvs = new Float32Array(keptVertexCount * 2 * 2)
  finalUvs.set(topUvs, 0)
  finalUvs.set(topUvs, keptVertexCount * 2)

  const finalIndices =[]
  const edgeCount = new Map()
  const edgeMap = new Map()

  for (let i = 0; i < keptFaces.length; i += 3) {
    const a_raw = keptFaces[i]
    const b_raw = keptFaces[i+1]
    const c_raw = keptFaces[i+2]

    const a = vertexMap[a_raw]
    const b = vertexMap[b_raw]
    const c = vertexMap[c_raw]

    // 压入顶面
    finalIndices.push(a, b, c)
    // 压入底面 (法线反向)
    const a_bot = a + keptVertexCount
    const b_bot = b + keptVertexCount
    const c_bot = c + keptVertexCount
    finalIndices.push(c_bot, b_bot, a_bot)

    // 统计边缘以生成墙壁
    const addEdge = (v1, v2) => {
      const key = Math.min(v1, v2) + '_' + Math.max(v1, v2)
      if (edgeCount.has(key)) {
        edgeCount.set(key, edgeCount.get(key) + 1)
      } else {
        edgeCount.set(key, 1)
        edgeMap.set(key, { v1, v2 })
      }
    }
    addEdge(a, b)
    addEdge(b, c)
    addEdge(c, a)
  }

  // 为所有悬空的边界构建竖直的“墙壁”
  for (const [key, count] of edgeCount.entries()) {
    if (count === 1) { // 只有引用一次的边是外界边缘
      const { v1, v2 } = edgeMap.get(key)
      const v1_bot = v1 + keptVertexCount
      const v2_bot = v2 + keptVertexCount
      finalIndices.push(v1, v1_bot, v2_bot)
      finalIndices.push(v1, v2_bot, v2)
    }
  }

  // 生成最终的水密几何体
  const reliefGeo = new THREE.BufferGeometry()
  reliefGeo.setAttribute('position', new THREE.BufferAttribute(finalVertices, 3))
  reliefGeo.setAttribute('uv', new THREE.BufferAttribute(finalUvs, 2))
  reliefGeo.setIndex(finalIndices)

  reliefGeo.computeVertexNormals()

  // 坐标复位与矩阵变换
  reliefGeo.rotateX(-Math.PI / 2)
  reliefGeo.scale(1, 1, -1)
  reliefGeo.computeVertexNormals()
  reliefGeo.translate(reliefPosition.x, 0, reliefPosition.y)
  reliefGeo.computeBoundingBox()
  
  reliefGeoRaw.dispose() // 释放缓存
  
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
  
  // 1. 统一缩放 (Scale) 到毫米单位
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
  
  // 2. 贴地处理 (Floor Alignment)
  // 缩放后重新计算包围盒
  mergedGeo.computeBoundingBox()
  const minY = mergedGeo.boundingBox.min.y
  mergedGeo.translate(0, -minY, 0) // 底部对齐 Y=0
  
  // 3. 强制居中 (Center) - 只在X和Z方向居中，保持Y方向的贴地效果
  mergedGeo.computeBoundingBox()
  const center = new THREE.Vector3()
  mergedGeo.boundingBox.getCenter(center)
  mergedGeo.translate(-center.x, 0, -center.z)

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
  
  // 清理中间几何体，释放内存
  try {
    if (caseGeometry) caseGeometry.dispose()
    if (reliefGeo) reliefGeo.dispose()
    if (caseGeoNonIndexed) caseGeoNonIndexed.dispose()
    if (reliefGeoNonIndexed) reliefGeoNonIndexed.dispose()
    // 注意：不清理mergedGeo，因为它被mesh使用
  } catch (e) {
    console.warn("Error during geometry cleanup:", e)
  }
  
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
  const res = await fetch("http://127.0.0.1:8000/depth", {
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
  const res = await fetch("http://127.0.0.1:8000/depth/by-url", {
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
  const [embossHeight, setEmbossHeight] = useState([4])
  const [embossSize, setEmbossSize] = useState([60])
  const [reliefRotation, setReliefRotation] = useState(0)
  const [depthVersion, setDepthVersion] = useState(0)
  const [isGenerated, setIsGenerated] = useState(false)
  const [isAdjustMode, setIsAdjustMode] = useState(false)
  const [reliefPosition, setReliefPosition] = useState({ x: 0, y: 0 })
  
  // 内存监控和清理机制
  useEffect(() => {
    if (typeof window === 'undefined' || !window.performance) return
    
    const checkMemoryUsage = () => {
      try {
        if (window.performance.memory) {
          const memory = window.performance.memory
          const usedJSHeapSize = memory.usedJSHeapSize / (1024 * 1024) // MB
          const totalJSHeapSize = memory.totalJSHeapSize / (1024 * 1024) // MB
          
          console.log(`Memory usage: ${usedJSHeapSize.toFixed(2)} MB / ${totalJSHeapSize.toFixed(2)} MB`)
          
          // 如果内存使用超过80%，建议浏览器进行垃圾回收
          if (usedJSHeapSize / totalJSHeapSize > 0.8) {
            console.warn("High memory usage detected, triggering garbage collection")
            if (window.gc) {
              window.gc()
            }
          }
        }
      } catch (e) {
        // performance.memory 可能在某些浏览器中不可用
      }
    }
    
    // 每隔10秒检查一次内存使用情况
    const interval = setInterval(checkMemoryUsage, 10000)
    
    return () => {
      clearInterval(interval)
    }
  }, [])
  
  // 清理深度图URL的函数
  const cleanupDepthUrl = () => {
    if (depthUrl && depthUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(depthUrl)
        console.log("Revoked depth URL:", depthUrl)
      } catch (e) {
        console.warn("Failed to revoke old depth URL:", e)
      }
    }
  }

  const [isLoading, setIsLoading] = useState(false)

  // 检查是否选择了手机型号
  const checkPhoneModel = () => {
    if (!phoneModel) {
      alert("请先选择手机型号")
      return false
    }
    return true
  }

  const handleAiGenerate = async () => {
    // 检查是否选择了手机型号
    if (!checkPhoneModel()) return
    
    try {
      console.log("开始 AI 生成，prompt:", aiPrompt)
      
      // 设置生成状态，禁止操作
      setIsGenerating(true)
      
      // 清理之前的深度图URL，释放内存
      cleanupDepthUrl()
      
      const imageUrl = await generateImage(aiPrompt || "")
      console.log("AI 生成图片 URL:", imageUrl)
      setUploadedImage(imageUrl)
      setUploadedFile(null)
      
      // 只更新上传的图片，不直接调用深度图生成
      // 深度图生成将在用户点击生成浮雕时进行
      setIsGenerated(false)
    } catch (err) {
      console.error(err)
      alert(`AI 生成失败: ${err.message}`)
    } finally {
      // 无论成功失败，都要重置生成状态
      setIsGenerating(false)
    }
  }

  const handleGenerate3D = async () => {
    // 检查是否选择了手机型号
    if (!checkPhoneModel()) return
    
    console.log("开始生成")
    try {
      setIsLoading(true)
      setIsDepthGenerating(true)
      
      // 清理之前的深度图URL，释放内存
      cleanupDepthUrl()
      
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
      if (uploadedImage) {
        // 处理AI生成的图片，调用深度图生成
        const depthObjUrl = await generateDepthByUrl(uploadedImage)
        setDepthUrl(depthObjUrl)
        setDepthVersion(v => v + 1)
        setIsGenerated(true)
        return
      }
    } catch (err) {
      console.error(err)
      alert("生成失败")
    } finally {
      setIsLoading(false)
      setIsDepthGenerating(false)
    }
  }

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      // 清理深度图URL
      cleanupDepthUrl()
    }
  }, [])

  const handleExportSTL = async () => {
    // 检查是否选择了手机型号
    if (!checkPhoneModel()) return
    
    if (!depthUrl) {
      alert("请先生成深度图后再导出 STL")
      return
    }
    const currentModel = phoneModel || "iphone16" // 默认回退到 iphone16
    let embossedMesh = null
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

      embossedMesh = await buildCombinedMesh({
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
    } catch (error) {
      console.error("导出 STL 失败:", error)
      alert(`导出 STL 失败: ${error.message}`)
    } finally {
      // 确保清理mesh资源
      if (embossedMesh) {
        try {
          if (embossedMesh.geometry) embossedMesh.geometry.dispose()
          if (embossedMesh.material) embossedMesh.material.dispose()
        } catch (e) {
          console.warn("Error during mesh cleanup:", e)
        }
      }
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

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mb-4"></div>
            <h3 className="text-lg font-medium mb-2">正在加载...</h3>
            <p className="text-sm text-gray-500">请勿刷新网页</p>
            <p className="text-sm text-muted-foreground">请稍候，正在生成深度图</p>
          </div>
        </div>
      ) : (
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
                phoneModel={phoneModel}
                onHistoryImageSelect={async (image) => {
                  // 检查是否选择了手机型号
                  if (!checkPhoneModel()) return
                  
                  try {
                    setIsLoading(true)
                    // 直接使用已有的深度图，不需要重新推理
                    setDepthUrl(image.depthUrl)
                    setDepthVersion(v => v + 1)
                    setIsGenerated(true)
                    setUploadedImage(image.url)
                    setUploadedFile(null)
                  } catch (err) {
                    console.error(err)
                    alert(`加载深度图失败: ${err.message}`)
                  } finally {
                    setIsLoading(false)
                  }
                }}
              />
              <div className="h-px bg-border/40" />
              {isGenerated && (
                <EmbossParameters
                  height={embossHeight}
                  size={embossSize}
                  rotation={reliefRotation}
                  onHeightChange={setEmbossHeight}
                  onSizeChange={setEmbossSize}
                  onRotationChange={setReliefRotation}
                />
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-border/60 p-4">
              <Button onClick={handleGenerate3D} className="w-full" size="lg" disabled={isLoading}>
                <Layers className="size-4" />
                生成 3D 浮雕
              </Button>
              <Button onClick={handleExportSTL} variant="outline" className="w-full" size="lg" disabled={!isGenerated || isLoading}>
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
      )}
    </div>
  )
}

import { useRef, useMemo, useState, useCallback, useEffect } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
console.log("🔥 Scene3D from components loaded")
const { DoubleSide } = THREE

const DEFAULT_PHONE_W = 7
const DEFAULT_PHONE_H = 14
const DEFAULT_PHONE_T = 0.5
const DEFAULT_PLANE_Y = DEFAULT_PHONE_T / 2
const RELIEF_OFFSET = 0.02

const RELIEF_X_MIN = -DEFAULT_PHONE_W / 2 + 0.5
const RELIEF_X_MAX = DEFAULT_PHONE_W / 2 - 0.5
const RELIEF_Z_MIN = -DEFAULT_PHONE_H / 2 + 0.5
const RELIEF_Z_MAX = DEFAULT_PHONE_H / 2 - 0.5

// 硬编码掩模位置参数（校准后的结果）
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

function clampRelief(pos) {
  return {
    x: Math.max(RELIEF_X_MIN, Math.min(RELIEF_X_MAX, pos.x)),
    y: Math.max(RELIEF_Z_MIN, Math.min(RELIEF_Z_MAX, pos.z)),
  }
}

const DEFAULT_DEPTH_MAP_URL = "http://localhost:8001/depth/latest"

function SafeDisplacementMaterial({ displacementScale }) {
  const [texture, setTexture] = useState(null)
  const textureRef = useRef(null)
  const scale = Array.isArray(displacementScale) ? displacementScale[0] : displacementScale
  const scaleValue = (scale / 10) * 5

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    loader.load(
      DEFAULT_DEPTH_MAP_URL + "?t=" + Date.now(),
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        textureRef.current = tex
        setTexture(tex)
      },
      undefined,
      () => setTexture(null)
    )
    return () => {
      if (textureRef.current) {
        textureRef.current.dispose()
        textureRef.current = null
      }
    }
  }, [])

  const matProps = {
    color: "#d4d4d4",
    side: DoubleSide,
    roughness: 0.4,
    metalness: 0.1,
  }
  if (!texture) {
    return <meshStandardMaterial {...matProps} />
  }
  return (
    <meshStandardMaterial
      {...matProps}
      displacementMap={texture}
      displacementScale={scaleValue}
      displacementBias={0}
    />
  )
}

const getClippedShader = (shader, { caseWidth, caseHeight, isAdjustMode, planeY, maskTexture, maskLegalIsBlack }) => {
  // 确保所有uniforms都被正确初始化
  shader.uniforms.uIsAdjustMode = { value: isAdjustMode ? 1.0 : 0.0 }
  shader.uniforms.uCaseWidth = { value: caseWidth }
  shader.uniforms.uCaseHeight = { value: caseHeight }
  shader.uniforms.uPlaneY = { value: planeY }
  shader.uniforms.uMaskLegalIsBlack = { value: maskLegalIsBlack ? 1.0 : 0.0 }
  shader.uniforms.uMaskScale = { value: new THREE.Vector2(IPHONE16_MASK_CONFIG.scaleX, IPHONE16_MASK_CONFIG.scaleY) }
  shader.uniforms.uMaskOffset = { value: new THREE.Vector2(IPHONE16_MASK_CONFIG.offsetX, IPHONE16_MASK_CONFIG.offsetY) }
  shader.uniforms.uMaskTranslate = { value: new THREE.Vector2(IPHONE16_MASK_CONFIG.translateX, IPHONE16_MASK_CONFIG.translateY) }
  shader.uniforms.uMaskFlip = { value: new THREE.Vector2(IPHONE16_MASK_CONFIG.flipX ? 1 : 0, IPHONE16_MASK_CONFIG.flipY ? 1 : 0) }
  shader.uniforms.uMaskRotate = { value: IPHONE16_MASK_CONFIG.rotDeg * Math.PI / 180.0 }
  // 确保uMask uniform总是被初始化，即使maskTexture为null
  shader.uniforms.uMask = { value: maskTexture || null }

  // 保存原始的vertexShader，以便我们可以正确地修改它
  const originalVertexShader = shader.vertexShader;
  
  // 首先添加我们的varying变量声明
  // 我们需要确保这些声明在任何其他代码之前
  shader.vertexShader = `
    varying vec3 vLocalPosition;
    varying vec3 vWorldPosition;
    varying vec2 vUv;
  ` + originalVertexShader;
  
  // 在main函数的开始处添加我们的代码
  // 注意：我们需要确保我们的代码不会影响Three.js默认的displacementMap逻辑
  shader.vertexShader = shader.vertexShader.replace(
    'void main() {',
    'void main() {\n      vLocalPosition = position;\n      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;\n      vUv = uv;\n'
  );
  
  // 修改位移映射逻辑，只对顶面顶点应用位移
  shader.vertexShader = shader.vertexShader.replace(
    '#include <displacementmap_vertex>',
    `
    #ifdef USE_DISPLACEMENTMAP
      // 只有当本地坐标 z > -0.005 时才应用位移（即只作用于顶面）
      if (position.z > -0.005) {
        vec3 vNormal = normalize( normal );
        float fDisplacement = texture2D( displacementMap, uv ).x;
        transformed += vNormal * ( fDisplacement * displacementScale + displacementBias );
      }
    #endif
    `
  );

  // 修改fragmentShader
  // 我们只修改fragmentShader，确保我们的修改不会影响vertexShader中的displacementMap逻辑
  shader.fragmentShader = `
    uniform float uIsAdjustMode;
    uniform float uCaseWidth;
    uniform float uCaseHeight;
    uniform float uPlaneY;
    uniform sampler2D uMask;
    uniform float uMaskLegalIsBlack;
    uniform vec2 uMaskScale;
    uniform vec2 uMaskOffset;
    uniform vec2 uMaskTranslate;
    uniform vec2 uMaskFlip;
    uniform float uMaskRotate;
    varying vec3 vLocalPosition;
    varying vec3 vWorldPosition;
  ` + shader.fragmentShader.replace(
    'vec4 diffuseColor = vec4( diffuse, opacity );',
    `
    vec2 wp = vec2(vWorldPosition.x, vWorldPosition.z) - uMaskTranslate;
    bool outside = abs(wp.x) > (uCaseWidth * 0.5) || abs(wp.y) > (uCaseHeight * 0.5);
    
    // Perform rotation in world coordinates to avoid aspect ratio distortion
    float c = cos(uMaskRotate);
    float s = sin(uMaskRotate);
    mat2 R = mat2(c, -s, s, c);
    vec2 rotatedWp = R * wp;
    
    // Calculate UV based on rotated world position
    vec2 uv = vec2(rotatedWp.x / (uCaseWidth * uMaskScale.x) + 0.5, rotatedWp.y / (uCaseHeight * uMaskScale.y) + 0.5);
    
    // Handle Flip
    if (uMaskFlip.x > 0.5) uv.x = 1.0 - uv.x;
    if (uMaskFlip.y > 0.5) uv.y = 1.0 - uv.y;
    
    // Add Offset
    uv = uv - uMaskOffset;
    
    float maskv = 1.0;
    ${maskTexture ? 'maskv = texture2D(uMask, uv).r;' : ''}
    
    bool underPlane = vWorldPosition.y < (uPlaneY + 1e-4);
    // 修正掩码逻辑，确保与App.jsx中的isPointInMask函数逻辑一致
    bool hole = (uMaskLegalIsBlack > 0.5) ? (maskv > 0.5) : (maskv < 0.5);
    
    vec4 diffuseColor = vec4( diffuse, opacity );
    if (outside || hole || underPlane) {
      if (uIsAdjustMode > 0.5) {
        diffuseColor = mix(diffuseColor, vec4(1.0, 0.0, 0.0, 0.5), 0.6);
      } else {
        discard;
      }
    }
    `
  )
  return shader
}

function ReliefClippedMaterial({ 
  isGenerated, 
  displacementScale, 
  isAdjustMode, 
  caseWidth, 
  caseHeight, 
  depthTexture, 
  maskTexture, 
  planeY, 
  maskLegalIsBlack = false
 }) {
  const matRef = useRef(null)
  const materialKey = useMemo(() => {
    // 当maskTexture变化时，强制重新创建材质
    return `${isGenerated}-${depthTexture?.id || 'null'}-${maskTexture?.id || 'null'}-${maskLegalIsBlack}`
  }, [isGenerated, depthTexture, maskTexture, maskLegalIsBlack])

  // 确保深度纹理有效
  if (isGenerated && depthTexture) {
    console.log("Rendering ReliefClippedMaterial with depthTexture", depthTexture.id)
  }

  // 使用useFrame实时更新shader的uniform值
  useFrame(() => {
    const mat = matRef.current
    if (!mat) return
    
    // 实时计算scaleValue
    const scale = Array.isArray(displacementScale) ? displacementScale[0] : displacementScale
    const scaleValue = (scale / 10) * 5
    
    const shader = mat.userData.shader
    if (shader) {
      // 实时更新uIsAdjustMode uniform值
      shader.uniforms.uIsAdjustMode.value = isAdjustMode ? 1.0 : 0.0
      
      // 确保其他uniforms也保持最新
      shader.uniforms.uCaseWidth.value = caseWidth
      shader.uniforms.uCaseHeight.value = caseHeight
      shader.uniforms.uPlaneY.value = planeY
      shader.uniforms.uMaskLegalIsBlack.value = maskLegalIsBlack ? 1.0 : 0.0
      
      // 使用硬编码参数
      shader.uniforms.uMaskScale.value.set(IPHONE16_MASK_CONFIG.scaleX, IPHONE16_MASK_CONFIG.scaleY)
      shader.uniforms.uMaskOffset.value.set(IPHONE16_MASK_CONFIG.offsetX, IPHONE16_MASK_CONFIG.offsetY)
      shader.uniforms.uMaskTranslate.value.set(IPHONE16_MASK_CONFIG.translateX, IPHONE16_MASK_CONFIG.translateY)
      shader.uniforms.uMaskFlip.value.set(IPHONE16_MASK_CONFIG.flipX ? 1 : 0, IPHONE16_MASK_CONFIG.flipY ? 1 : 0)
      shader.uniforms.uMaskRotate.value = IPHONE16_MASK_CONFIG.rotDeg * Math.PI / 180.0
      
      // 确保displacementMap相关的uniforms被正确更新
      if (shader.uniforms.displacementMap) {
        shader.uniforms.displacementMap.value = depthTexture
      }
      if (shader.uniforms.displacementScale) {
        shader.uniforms.displacementScale.value = scaleValue
      }
      if (shader.uniforms.displacementBias) {
        shader.uniforms.displacementBias.value = 0
      }
      if (shader.uniforms.map) {
        shader.uniforms.map.value = depthTexture
      }
      if (shader.uniforms.alphaMap) {
        shader.uniforms.alphaMap.value = depthTexture
      }
      
      if (shader.uniforms.uMask) {
        shader.uniforms.uMask.value = maskTexture
      }
    }
  })

  const commonProps = {
    ref: matRef,
    color: "#c0c0c0", // 更亮的颜色，增强细节可见性
    side: DoubleSide,
    roughness: 0.6, // 适当减少粗糙度，让光线更好地反射细节
    metalness: 0.0, // 保持非金属感
    transparent: false, // 移除透明效果
  }
  
  if (isGenerated && depthTexture) {
    // 计算scaleValue
    const scale = Array.isArray(displacementScale) ? displacementScale[0] : displacementScale
    const scaleValue = (scale / 10) * 5
    
    return (
      <meshStandardMaterial
        key={materialKey}
        {...commonProps}
        map={depthTexture} // 显式绑定颜色贴图，这样即使置换不明显，也能看到图片
        displacementMap={depthTexture}
        alphaMap={depthTexture} 
        displacementScale={scaleValue}
        displacementBias={0}
        onBeforeCompile={(shader) => {
          // 保存shader到userData，方便useFrame中访问
          matRef.current.userData.shader = shader;
          
          // 应用我们的shader修改
          getClippedShader(shader, { caseWidth, caseHeight, isAdjustMode, planeY, maskTexture, maskLegalIsBlack });
          
          // 立即设置所有uniforms，确保shader编译后正确初始化
          shader.uniforms.uIsAdjustMode.value = isAdjustMode ? 1.0 : 0.0;
          shader.uniforms.uCaseWidth.value = caseWidth;
          shader.uniforms.uCaseHeight.value = caseHeight;
          shader.uniforms.uPlaneY.value = planeY;
          shader.uniforms.uMaskLegalIsBlack.value = maskLegalIsBlack ? 1.0 : 0.0;
          
          // 使用硬编码参数
          shader.uniforms.uMaskScale.value.set(IPHONE16_MASK_CONFIG.scaleX, IPHONE16_MASK_CONFIG.scaleY);
          shader.uniforms.uMaskOffset.value.set(IPHONE16_MASK_CONFIG.offsetX, IPHONE16_MASK_CONFIG.offsetY);
          shader.uniforms.uMaskTranslate.value.set(IPHONE16_MASK_CONFIG.translateX, IPHONE16_MASK_CONFIG.translateY);
          shader.uniforms.uMaskFlip.value.set(IPHONE16_MASK_CONFIG.flipX ? 1 : 0, IPHONE16_MASK_CONFIG.flipY ? 1 : 0);
          shader.uniforms.uMaskRotate.value = IPHONE16_MASK_CONFIG.rotDeg * Math.PI / 180.0;
          
          // 确保displacementMap相关的uniforms被正确设置
          if (shader.uniforms.displacementMap) {
            shader.uniforms.displacementMap.value = depthTexture;
          }
          if (shader.uniforms.displacementScale) {
            shader.uniforms.displacementScale.value = scaleValue;
          }
          if (shader.uniforms.displacementBias) {
            shader.uniforms.displacementBias.value = 0;
          }
          if (shader.uniforms.map) {
            shader.uniforms.map.value = depthTexture;
          }
          if (shader.uniforms.alphaMap) {
            shader.uniforms.alphaMap.value = depthTexture;
          }
          
          if (maskTexture) {
            shader.uniforms.uMask.value = maskTexture;
          }
        }}
      />
    )
  }
  return <meshStandardMaterial {...commonProps} />
}

/**
 * 将屏幕坐标转为与平面 Y=RELIEF_Y 的交点（世界坐标 XZ）
 */
function pointerToPlaneIntersection(clientX, clientY, camera, gl, plane, target) {
  const rect = gl.domElement.getBoundingClientRect()
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
  return raycaster.ray.intersectPlane(plane, target) ? target.clone() : null
}

/**
 * 浮雕平面：position 始终来自 reliefPosition；
 * 调整模式下在 mesh 上绑定指针事件实现二维拖拽，并仅在浮雕上设置 grab/grabbing 光标。
 */
function EraserCapturePlane({ 
  isEraserMode, 
  reliefPosition, 
  planeY, 
  onEraserDraw, 
  scale 
}) {
  const meshRef = useRef(null)
  
  if (!isEraserMode) return null

  return (
    <mesh
      ref={meshRef}
      position={[reliefPosition.x, planeY + RELIEF_OFFSET + 0.05, reliefPosition.y]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[scale, scale, 1]}
      visible={false}
    >
      <planeGeometry args={[7, 7]} /> 
      <meshBasicMaterial visible={false} />
      
      <mesh
        onPointerDown={(e) => {
            e.stopPropagation()
            e.target.setPointerCapture(e.pointerId)
            onEraserDraw(e.uv, "start")
        }}
        onPointerMove={(e) => {
            if (e.buttons === 1) {
                e.stopPropagation()
                onEraserDraw(e.uv, "move")
            }
        }}
        onPointerUp={(e) => {
            e.stopPropagation()
            e.target.releasePointerCapture(e.pointerId)
            onEraserDraw(e.uv, "end")
        }}
      >
         <planeGeometry args={[7, 7]} />
         <meshBasicMaterial transparent opacity={0.0} depthWrite={false} color="red" />
      </mesh>
    </mesh>
  )
}

function ReliefPlane({
  depthVersion,
  isGenerated,
  isAdjustMode,
  reliefPosition,
  reliefSize,
  reliefHeight,
  reliefRotation,
  depthMapUrl,
  caseWidth,
  caseHeight,
  planeY,
  maskTexture,
  maskLegalIsBlack,
  isEraserMode,
  onEraserDraw
}) {
  const meshRef = useRef(null)
  const [planeDims, setPlaneDims] = useState({ w: 7, h: 7 })

  // 降低预览状态的细分度至256
  const SEGMENTS_W = 256
  const SEGMENTS_H = 256

  const [depthTex, setDepthTex] = useState(null)
  const [isDrawing, setIsDrawing] = useState(false)
  
  const eraserCanvasRef = useRef(null)
  const eraserContextRef = useRef(null)
  const eraserTextureRef = useRef(null)
  const textureLoaderRef = useRef(null)

  // 生成水密几何体的函数
  const createWatertightGeometry = useCallback((width, height, segmentsW, segmentsH) => {
    // 使用 PlaneGeometry 作为基础顶点源
    const reliefGeoRaw = new THREE.PlaneGeometry(width, height, segmentsW, segmentsH)
    const posAttrRaw = reliefGeoRaw.getAttribute("position")
    const indexAttrRaw = reliefGeoRaw.getIndex()

    if (!indexAttrRaw) {
      reliefGeoRaw.dispose()
      return new THREE.PlaneGeometry(width, height, segmentsW, segmentsH)
    }

    const rawIndices = indexAttrRaw.array
    const keptFaces = []

    // 保留所有面，因为预览时不需要掩码过滤
    for (let i = 0; i < rawIndices.length; i += 3) {
      keptFaces.push(rawIndices[i], rawIndices[i+1], rawIndices[i+2])
    }

    // 构建独立顶点池
    const vertexMap = new Int32Array(posAttrRaw.count).fill(-1)
    let keptVertexCount = 0
    const topVertices = []
    const uvsRaw = reliefGeoRaw.getAttribute("uv")
    const topUvs = []

    for (let i = 0; i < keptFaces.length; i++) {
      const rawIdx = keptFaces[i]
      if (vertexMap[rawIdx] === -1) {
        vertexMap[rawIdx] = keptVertexCount
        topVertices.push(
          posAttrRaw.getX(rawIdx),
          posAttrRaw.getY(rawIdx),
          0.01 // 预览时使用0.01作为基础高度，确保位移映射生效
        )
        if (uvsRaw) {
          topUvs.push(uvsRaw.getX(rawIdx), uvsRaw.getY(rawIdx))
        }
        keptVertexCount++
      }
    }

    // 复制顶点作为底面，缝合顶底
    const finalVertices = new Float32Array(keptVertexCount * 3 * 2)
    const bottomVertices = []
    const baseZ = -0.01 // 与导出时保持一致，嵌入0.01mm
    for(let i = 0; i < keptVertexCount; i++) {
      bottomVertices.push(topVertices[i*3], topVertices[i*3+1], baseZ)
    }
    finalVertices.set(topVertices, 0)
    finalVertices.set(bottomVertices, keptVertexCount * 3)

    const finalUvs = new Float32Array(keptVertexCount * 2 * 2)
    if (uvsRaw) {
      finalUvs.set(topUvs, 0)
      finalUvs.set(topUvs, keptVertexCount * 2)
    }

    const finalIndices = []
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
    if (uvsRaw) {
      reliefGeo.setAttribute('uv', new THREE.BufferAttribute(finalUvs, 2))
    }
    reliefGeo.setIndex(finalIndices)
    reliefGeo.computeVertexNormals()

    reliefGeoRaw.dispose() // 释放缓存
    return reliefGeo
  }, [])

  const geometry = useMemo(() => {
    return createWatertightGeometry(planeDims.w, planeDims.h, SEGMENTS_W, SEGMENTS_H)
  }, [planeDims.w, planeDims.h, createWatertightGeometry])

  const sizeVal = Array.isArray(reliefSize) ? reliefSize[0] : reliefSize
  const scale = 0.3 + ((sizeVal - 20) / 180) * 2.2
  
  useEffect(() => {
    let isMounted = true
    
    // 初始化纹理加载器
    textureLoaderRef.current = new THREE.TextureLoader()
    const loader = textureLoaderRef.current
    
    const url = depthMapUrl || DEFAULT_DEPTH_MAP_URL
    
    const isBlob = url.startsWith("blob:")
    const timestampedUrl = isBlob ? url : (url + (url.includes('?') ? '&' : '?') + "t=" + Date.now())
    
    console.log("Loading depth texture from:", timestampedUrl)
    console.log("Mask legal is black:", maskLegalIsBlack)

    // 清理之前的纹理
    if (eraserTextureRef.current) {
      eraserTextureRef.current.dispose()
      eraserTextureRef.current = null
    }

    loader.load(
      timestampedUrl,
      (tex) => {
        if (!isMounted) {
          tex.dispose()
          return
        }
        console.log("Depth texture loaded successfully", tex.image.width, tex.image.height)
        
        const img = tex.image
        
        // 直接使用从TextureLoader加载的纹理作为depthTex
        // 这样可以确保displacementMap正常工作
        tex.colorSpace = THREE.NoColorSpace
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.generateMipmaps = false
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
        tex.needsUpdate = true
        
        if (img && img.width && img.height) {
          const aspect = img.width / img.height
          const baseH = 7
          setPlaneDims({ w: baseH * aspect, h: baseH })
        } else {
          setPlaneDims({ w: 7, h: 7 })
        }
        
        setDepthTex(prev => {
          if (prev) prev.dispose()
          return tex
        })
      },
      undefined,
      (err) => {
        console.error("Failed to load depth texture:", err)
        if (isMounted) {
          setPlaneDims({ w: 7, h: 7 })
          setDepthTex(prev => {
            if (prev) prev.dispose()
            return null
          })
        }
      }
    )
    return () => {
      isMounted = false
      // 清理资源
      if (eraserTextureRef.current) {
        eraserTextureRef.current.dispose()
        eraserTextureRef.current = null
      }
      if (eraserCanvasRef.current) {
        // 清理全局引用
        if (window.__eraserCanvas === eraserCanvasRef.current) {
          window.__eraserCanvas = null
        }
        eraserCanvasRef.current = null
      }
      eraserContextRef.current = null
    }
  }, [depthMapUrl, depthVersion, maskLegalIsBlack])

  useEffect(() => {
    if (onEraserDraw) {
        // Parent callback if needed
    }
  }, [onEraserDraw])

  const drawEraser = (uv) => {
    const canvas = eraserCanvasRef.current
    const ctx = eraserContextRef.current
    const tex = eraserTextureRef.current
    
    if (!canvas || !ctx || !tex) return

    const x = uv.x * canvas.width
    const y = (1.0 - uv.y) * canvas.height
    
    const radius = Math.max(20, canvas.width * 0.05) 

    ctx.globalCompositeOperation = "source-over"
    ctx.fillStyle = "black" 
    
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    
    tex.needsUpdate = true
  }

  const onEraserInteraction = (uv, type) => {
      if (type === "move" || type === "start") {
          drawEraser(uv)
      }
  }
  
  useEffect(() => {
      if (eraserCanvasRef.current) {
          window.__eraserCanvas = eraserCanvasRef.current
      }
  }, [depthTex])

  const rotTargetRef = useRef(0)
  useEffect(() => {
    rotTargetRef.current = (reliefRotation * Math.PI) / 180
  }, [reliefRotation])

  useFrame(() => {
    if (!meshRef.current) return
    const m = meshRef.current
    m.rotation.x = -Math.PI / 2
    m.rotation.y = 0
    m.rotation.z = THREE.MathUtils.lerp(m.rotation.z, -rotTargetRef.current, 0.1)
  })

  useEffect(() => {
    if (!meshRef.current) return
    const mesh = meshRef.current
    const original = mesh.raycast?.bind(mesh)
    if (isAdjustMode) {
      mesh.raycast = () => {}
    } else if (original) {
      mesh.raycast = original
    }
  }, [isAdjustMode])

  return (
    <>
      <mesh
        ref={meshRef}
        geometry={geometry}
        visible={isGenerated}
        position={[reliefPosition.x, planeY + RELIEF_OFFSET, reliefPosition.y]}
        scale={[scale, scale, 1]}
        castShadow
        receiveShadow
      >
        <ReliefClippedMaterial
          isGenerated={isGenerated}
          displacementScale={reliefHeight}
          isAdjustMode={isAdjustMode}
          caseWidth={caseWidth}
          caseHeight={caseHeight}
          depthTexture={depthTex}
          depthMapUrl={depthMapUrl}
          maskTexture={maskTexture}
          maskLegalIsBlack={maskLegalIsBlack}
          planeY={planeY}
        />
      </mesh>
      
      <EraserCapturePlane 
        isEraserMode={isEraserMode}
        reliefPosition={reliefPosition}
        planeY={planeY}
        scale={scale}
        onEraserDraw={onEraserInteraction}
      />
    </>
  )
}

function AdjustCapturePlane({ isAdjustMode, reliefPosition, onReliefPositionChange, planeY }) {
  const dragOffsetRef = useRef(null)
  const rafRef = useRef(null)
  const lastPointRef = useRef(null)
  const onPointerDown = useCallback(
    (e) => {
      if (!isAdjustMode) return
      e.stopPropagation()
      document.body.style.cursor = "grabbing"
      const p = e.point
      dragOffsetRef.current = { dx: p.x - reliefPosition.x, dz: p.z - reliefPosition.y }
      e.target.setPointerCapture(e.pointerId)
    },
    [isAdjustMode, reliefPosition.x, reliefPosition.y]
  )
  const onPointerMove = useCallback(
    (e) => {
      if (!isAdjustMode || !dragOffsetRef.current) return
      lastPointRef.current = e.point.clone()
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const p = lastPointRef.current
        if (!p) return
        const newPos = { x: p.x - dragOffsetRef.current.dx, y: p.z - dragOffsetRef.current.dz }
        onReliefPositionChange(newPos)
      })
    },
    [isAdjustMode, onReliefPositionChange]
  )
  const onPointerUp = useCallback((e) => {
    if (!isAdjustMode) return
    e.target.releasePointerCapture(e.pointerId)
    dragOffsetRef.current = null
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    document.body.style.cursor = "auto"
  }, [isAdjustMode])
  const onPointerOver = useCallback(() => {
    if (!isAdjustMode) return
    document.body.style.cursor = "grab"
  }, [isAdjustMode])
  const onPointerOut = useCallback(() => {
    document.body.style.cursor = "auto"
  }, [])
  return (
    <mesh
      position={[0, planeY, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      <planeGeometry args={[2000, 2000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}

function CameraController({ isAdjustMode, controlsRef }) {
  const { camera } = useThree()
  const saved = useRef({
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
  })
  const isTopDown = useRef(false)

  useFrame(() => {
    if (isAdjustMode) {
      if (!isTopDown.current && controlsRef?.current) {
        saved.current.position.copy(camera.position)
        saved.current.target.copy(controlsRef.current.target)
      }
      isTopDown.current = true
      camera.position.set(0, 18, 0)
      camera.up.set(0, 0, -1)
      camera.lookAt(0, 0, 0)
    } else {
      if (isTopDown.current) {
        camera.position.copy(saved.current.position)
        camera.up.set(0, 1, 0)
        if (controlsRef?.current) {
          controlsRef.current.target.copy(saved.current.target)
        }
        isTopDown.current = false
      } else if (controlsRef?.current) {
        saved.current.position.copy(camera.position)
        saved.current.target.copy(controlsRef.current.target)
      }
    }
  })

  return null
}

function loadMaskTexture(model) {
  const tryLoad = (path) =>
    new Promise((resolve) => {
      const loader = new THREE.TextureLoader()
      loader.load(
        path,
        (tex) => {
          tex.flipY = false
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
          tex.minFilter = THREE.LinearFilter
          tex.magFilter = THREE.LinearFilter
          resolve(tex)
        },
        undefined,
        () => resolve(null)
      )
    })
  return (async () => {
    // 优先使用 <model>.png（黑色=合法，白色=孔洞）
    console.log(`Loading mask texture for model: ${model}`)
    let tex = await tryLoad(`/phonecase/${model}.png`)
    if (tex) {
      console.log(`Successfully loaded mask texture: /phonecase/${model}.png`)
      return { tex, legalIsBlack: true }
    }
    // 其次尝试 <model>_mask.png（白色=合法，黑色=孔洞）的旧约定
    tex = await tryLoad(`/phonecase/${model}_mask.png`)
    if (tex) {
      console.log(`Successfully loaded mask texture: /phonecase/${model}_mask.png`)
      return { tex, legalIsBlack: false }
    }
    console.warn(`No mask texture found for model: ${model}`)
    return { tex: null, legalIsBlack: false }
  })()
}

function generateMaskTextureAsync(mesh, width, height, sizeX, sizeZ, onDone) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  const imgData = ctx.createImageData(width, height)
  const rc = new THREE.Raycaster()
  const origin = new THREE.Vector3()
  const dir = new THREE.Vector3(0, -1, 0)
  const epsilon = 0.02
  let j = 0
  const stepRows = 8
  function processBatch() {
    const end = Math.min(j + stepRows, height)
    for (; j < end; j++) {
      for (let i = 0; i < width; i++) {
        const u = i / (width - 1)
        const v = j / (height - 1)
        const x = (u - 0.5) * sizeX
        const z = (v - 0.5) * sizeZ
        origin.set(x, 1.0, z)
        rc.set(origin, dir)
        const hits = rc.intersectObject(mesh, true)
        let ok = false
        if (hits && hits.length > 0) {
          const h = hits[0]
          if (Math.abs(h.point.y - 0.0) <= epsilon) ok = true
        }
        const idx = (j * width + i) * 4
        const val = ok ? 255 : 0
        imgData.data[idx] = val
        imgData.data[idx + 1] = val
        imgData.data[idx + 2] = val
        imgData.data[idx + 3] = 255
      }
    }
    if (j < height) {
      setTimeout(processBatch, 0)
    } else {
      ctx.putImageData(imgData, 0, 0)
      const tex = new THREE.CanvasTexture(canvas)
      tex.flipY = false
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.needsUpdate = true
      onDone(tex)
    }
  }
  setTimeout(processBatch, 0)
}

function PhoneCaseSTL({ isAdjustMode, onReady, model = "iphone16" }) {
  const meshRef = useRef(null)
  const [geom, setGeom] = useState(null)
  const stlLoaderRef = useRef(null)
  
  useEffect(() => {
    // 清理之前的几何体
    if (geom) {
      geom.dispose()
    }
    
    stlLoaderRef.current = new STLLoader()
    const loader = stlLoaderRef.current
    const path = `/phonecase/${model}.stl`
    
    loader.load(path, async (geometry) => {
      let g = geometry.clone()
      g.rotateX(Math.PI / 2)
      g.computeBoundingBox()
      const size0 = new THREE.Vector3()
      g.boundingBox.getSize(size0)
      const targetW = DEFAULT_PHONE_W
      const targetH = DEFAULT_PHONE_H
      const scaleFactor = Math.min(targetW / (size0.x || 1), targetH / (size0.z || 1))
      g.scale(scaleFactor, scaleFactor, scaleFactor)
      g.computeBoundingBox()
      const bb = g.boundingBox
      const center = new THREE.Vector3()
      bb.getCenter(center)
      const topY = bb.max.y
      g.translate(-center.x, -topY, -center.z)
      g.computeBoundingBox()
      const size = new THREE.Vector3()
      g.boundingBox.getSize(size)
      const caseWidth = size.x
      const caseHeight = size.z
      setGeom(g)
      const { tex: maskTex, legalIsBlack } = await loadMaskTexture(model)
      onReady({ caseWidth, caseHeight, planeY: 0.0, maskTexture: maskTex, maskLegalIsBlack: legalIsBlack })
      if (!maskTex) {
        const tempMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial())
        generateMaskTextureAsync(tempMesh, 96, 96, caseWidth, caseHeight, (tex) => {
          onReady({ caseWidth, caseHeight, planeY: 0.0, maskTexture: tex, maskLegalIsBlack: false })
        })
      }
    })
    
    return () => {
      // 清理资源
      if (geom) {
        geom.dispose()
      }
      // 清理网格资源
      if (meshRef.current) {
        const mesh = meshRef.current
        // 遍历Mesh的所有子项并销毁
        mesh.traverse((node) => {
          if (node.isMesh) {
            if (node.geometry) {
              node.geometry.dispose()
            }
            if (Array.isArray(node.material)) {
              node.material.forEach(m => m.dispose())
            } else if (node.material) {
              node.material.dispose()
            }
          }
        })
      }
    }
  }, [onReady, model, geom])
  
  useEffect(() => {
    if (!meshRef.current) return
    const mesh = meshRef.current
    const orig = mesh.raycast?.bind(mesh)
    if (isAdjustMode) {
      mesh.raycast = () => {}
    } else if (orig) {
      mesh.raycast = orig
    }
  }, [isAdjustMode])
  
  if (!geom) return null
  
  return (
    <mesh ref={meshRef} geometry={geom} position={[0, 0, 0]} receiveShadow={false} castShadow={false}>
      {isAdjustMode ? (
        <meshBasicMaterial color="#2a2a2a" />
      ) : (
        <meshStandardMaterial color="#2a2a2a" roughness={0.9} metalness={0.0} flatShading />
      )}
    </mesh>
  )
}

export function Scene3D({
  depthVersion,
  isGenerated,
  isAdjustMode,
  reliefPosition,
  onReliefPositionChange,
  embossHeight,
  embossSize,
  reliefRotation,
  depthUrl: depthMapUrl,
  phoneModel,
  isEraserMode,
  onEraserDraw,
}) {
  const controlsRef = useRef(null)
  const [caseWidth, setCaseWidth] = useState(DEFAULT_PHONE_W)
  const [caseHeight, setCaseHeight] = useState(DEFAULT_PHONE_H)
  const [planeY, setPlaneY] = useState(DEFAULT_PLANE_Y)
  const [maskTexture, setMaskTexture] = useState(null)
  const [maskLegalIsBlack, setMaskLegalIsBlack] = useState(false)

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={1.2}
        castShadow
      />
      <directionalLight
        position={[-5, 10, -5]}
        intensity={0.8}
      />
      <directionalLight
        position={[0, 10, -10]}
        intensity={0.5}
      />

      <group>
        {phoneModel === "iphone16" && (
          <PhoneCaseSTL
            isAdjustMode={isAdjustMode}
            model={phoneModel}
            onReady={({ caseWidth, caseHeight, planeY, maskTexture, maskLegalIsBlack }) => {
              setCaseWidth(caseWidth)
              setCaseHeight(caseHeight)
              setPlaneY(planeY)
              setMaskTexture(maskTexture)
              if (typeof maskLegalIsBlack === "boolean") {
                setMaskLegalIsBlack(maskLegalIsBlack)
              }
            }}
          />
        )}
        <ReliefPlane
          depthVersion={depthVersion}
          isGenerated={isGenerated}
          isAdjustMode={isAdjustMode}
          reliefPosition={reliefPosition}
          reliefSize={embossSize}
          reliefHeight={embossHeight}
          reliefRotation={reliefRotation}
          depthMapUrl={depthMapUrl}
          caseWidth={caseWidth}
          caseHeight={caseHeight}
          planeY={planeY}
          maskTexture={maskTexture}
          maskLegalIsBlack={maskLegalIsBlack}
          isEraserMode={isEraserMode}
          onEraserDraw={onEraserDraw}
        />
        {(isAdjustMode && isGenerated && !isEraserMode) && (
          <AdjustCapturePlane
            isAdjustMode={isAdjustMode}
            reliefPosition={reliefPosition}
            onReliefPositionChange={onReliefPositionChange}
            planeY={planeY}
          />
        )}
      </group>

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enabled={!isAdjustMode && !isEraserMode}
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={60}
        maxPolarAngle={Math.PI / 2 - 0.05}
        zoomToCursor={true}
        mouseWheelSpeed={2}
      />

      <CameraController isAdjustMode={isAdjustMode} controlsRef={controlsRef} />
    </>
  )
}
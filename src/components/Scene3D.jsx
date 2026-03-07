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
  scaleX: 1.2,
  scaleY: 0.92,
  offsetX: 0.0,
  offsetY: 0.0,
  translateX: 0.16,
  translateY: -0.14,
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

const DEFAULT_DEPTH_MAP_URL = "http://localhost:8000/depth/latest"

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
  if (maskTexture) {
    shader.uniforms.uMask = { value: maskTexture }
  }

  shader.vertexShader = `
    varying vec3 vLocalPosition;
    varying vec3 vWorldPosition;
  ` + shader.vertexShader.replace(
    'void main() {',
    `
    void main() {
      vLocalPosition = position;
      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    `
  )

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
  depthMapUrl,
  maskTexture,
  planeY,
  maskLegalIsBlack = false
 }) {
  const [texture, setTexture] = useState(null)
  const textureRef = useRef(null)
  const matRef = useRef(null)
  const scale = Array.isArray(displacementScale) ? displacementScale[0] : displacementScale
  const scaleValue = (scale / 10) * 5

  useEffect(() => {
  if (depthTexture) {
    textureRef.current = depthTexture
    setTexture(depthTexture)
    return
  }

  if (!depthMapUrl) return

  const loader = new THREE.TextureLoader()

  loader.load(
    depthMapUrl + "?t=" + Date.now(),
    (tex) => {
      tex.colorSpace = THREE.NoColorSpace
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = false
      tex.needsUpdate = true
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
}, [depthTexture, depthMapUrl])

  useEffect(() => {
    const mat = matRef.current
    if (!mat) return
    mat.onBeforeCompile = (shader) => {
      getClippedShader(shader, { caseWidth, caseHeight, isAdjustMode, planeY, maskTexture, maskLegalIsBlack })
      mat.userData.shader = shader
    }
    mat.needsUpdate = true
  }, [isAdjustMode, caseWidth, caseHeight, maskTexture, planeY, maskLegalIsBlack])

  useFrame(() => {
    const mat = matRef.current
    const shader = mat?.userData?.shader
    if (shader) {
      shader.uniforms.uIsAdjustMode.value = isAdjustMode ? 1.0 : 0.0
      shader.uniforms.uCaseWidth.value = caseWidth
      shader.uniforms.uCaseHeight.value = caseHeight
      if (shader.uniforms.uPlaneY) shader.uniforms.uPlaneY.value = planeY
      if (shader.uniforms.uMaskLegalIsBlack) shader.uniforms.uMaskLegalIsBlack.value = maskLegalIsBlack ? 1.0 : 0.0
      
      // 使用硬编码参数
      if (shader.uniforms.uMaskScale) shader.uniforms.uMaskScale.value.set(IPHONE16_MASK_CONFIG.scaleX, IPHONE16_MASK_CONFIG.scaleY)
      if (shader.uniforms.uMaskOffset) shader.uniforms.uMaskOffset.value.set(IPHONE16_MASK_CONFIG.offsetX, IPHONE16_MASK_CONFIG.offsetY)
      if (shader.uniforms.uMaskTranslate) shader.uniforms.uMaskTranslate.value.set(IPHONE16_MASK_CONFIG.translateX, IPHONE16_MASK_CONFIG.translateY)
      if (shader.uniforms.uMaskFlip) shader.uniforms.uMaskFlip.value.set(IPHONE16_MASK_CONFIG.flipX ? 1 : 0, IPHONE16_MASK_CONFIG.flipY ? 1 : 0)
      if (shader.uniforms.uMaskRotate) shader.uniforms.uMaskRotate.value = IPHONE16_MASK_CONFIG.rotDeg * Math.PI / 180.0
      
      if (maskTexture && shader.uniforms.uMask) {
        shader.uniforms.uMask.value = maskTexture
      }
    }
  })

  const commonProps = {
    ref: matRef,
    color: "#d4d4d4",
    side: DoubleSide,
    roughness: 0.4,
    metalness: 0.1,
    transparent: true,
    alphaTest: 0.05,
  }
  if (isGenerated) {
    if (!texture) return <meshStandardMaterial {...commonProps} />
    return (
      <meshStandardMaterial
        {...commonProps}
        displacementMap={texture}
        alphaMap={texture}
        displacementScale={scaleValue}
        displacementBias={0}
      />
    )
  }
  return <meshStandardMaterial {...commonProps} alphaMap={texture ?? undefined} />
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
  maskLegalIsBlack
}) {
  const meshRef = useRef(null)
  const [planeDims, setPlaneDims] = useState({ w: 7, h: 7 })
  const [depthTex, setDepthTex] = useState(null)
  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(planeDims.w, planeDims.h, 64, 64)
  }, [planeDims.w, planeDims.h])

  const sizeVal = Array.isArray(reliefSize) ? reliefSize[0] : reliefSize
  const scale = 0.3 + ((sizeVal - 20) / 180) * 2.2
  useEffect(() => {
    const loader = new THREE.TextureLoader()
    const url = depthMapUrl || DEFAULT_DEPTH_MAP_URL
    loader.load(
      url + "?t=" + Date.now(),
      (tex) => {
        tex.colorSpace = THREE.NoColorSpace   // ⭐关键
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.generateMipmaps = false
        tex.needsUpdate = true
        const img = tex.image
        if (img && img.width && img.height) {
          const aspect = img.width / img.height
          const baseH = 7
          setPlaneDims({ w: baseH * aspect, h: baseH })
        } else {
          setPlaneDims({ w: 7, h: 7 })
        }
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        setDepthTex(tex)
      },
      undefined,
      () => {
        setPlaneDims({ w: 7, h: 7 })
        setDepthTex(null)
      }
    )
    return () => {
      // keep texture for material reuse; do not dispose here to avoid double free
    }
  }, [depthMapUrl, depthVersion])
  const rotTargetRef = useRef(0)
  useEffect(() => {
    rotTargetRef.current = (reliefRotation * Math.PI) / 180
  }, [reliefRotation])
  useFrame(() => {
    if (!meshRef.current) return
    const m = meshRef.current
    m.rotation.x = -Math.PI / 2
    m.rotation.y = 0
    m.rotation.z = rotTargetRef.current
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
    let tex = await tryLoad(`/phonecase/${model}.png`)
    if (tex) return { tex, legalIsBlack: true }
    // 其次尝试 <model>_mask.png（白色=合法，黑色=孔洞）的旧约定
    tex = await tryLoad(`/phonecase/${model}_mask.png`)
    if (tex) return { tex, legalIsBlack: false }
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
  useEffect(() => {
    const loader = new STLLoader()
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
  }, [onReady, model])
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
  depthMapUrl,
  phoneModel,
}) {
  const controlsRef = useRef(null)
  const [caseWidth, setCaseWidth] = useState(DEFAULT_PHONE_W)
  const [caseHeight, setCaseHeight] = useState(DEFAULT_PHONE_H)
  const [planeY, setPlaneY] = useState(DEFAULT_PLANE_Y)
  const [maskTexture, setMaskTexture] = useState(null)
  const [maskLegalIsBlack, setMaskLegalIsBlack] = useState(false)

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={0.8}
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
        />
        {(isAdjustMode && isGenerated) && (
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
        enabled={!isAdjustMode}
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={30}
        maxPolarAngle={Math.PI / 2 - 0.05}
      />

      <CameraController isAdjustMode={isAdjustMode} controlsRef={controlsRef} />
    </>
  )
}

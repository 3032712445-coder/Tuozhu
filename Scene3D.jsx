import { useRef, useMemo, useState, useCallback, useEffect } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"

const { DoubleSide } = THREE

const PHONE_W = 7
const PHONE_H = 14
const PHONE_T = 0.5
const PLANE_Y = PHONE_T / 2
const RELIEF_OFFSET = 0.02
const RELIEF_Y = PLANE_Y + RELIEF_OFFSET
const RELIEF_X_MIN = -PHONE_W / 2 + 0.5
const RELIEF_X_MAX = PHONE_W / 2 - 0.5
const RELIEF_Z_MIN = -PHONE_H / 2 + 0.5
const RELIEF_Z_MAX = PHONE_H / 2 - 0.5

function clampRelief(pos) {
  return {
    x: Math.max(RELIEF_X_MIN, Math.min(RELIEF_X_MAX, pos.x)),
    y: Math.max(RELIEF_Z_MIN, Math.min(RELIEF_Z_MAX, pos.z)),
  }
}

const DEFAULT_DEPTH_MAP_URL = "/test-depth.jpg"

function SafeDisplacementMaterial({ displacementScale }) {
  const [texture, setTexture] = useState(null)
  const textureRef = useRef(null)
  const scale = Array.isArray(displacementScale) ? displacementScale[0] : displacementScale
  const scaleValue = (scale / 10) * 0.5

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    loader.load(
      DEPTH_MAP_URL,
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

function ReliefClippedMaterial({ isGenerated, displacementScale, isAdjustMode, caseWidth, caseHeight, depthTexture }) {
  const [texture, setTexture] = useState(null)
  const textureRef = useRef(null)
  const matRef = useRef(null)
  const scale = Array.isArray(displacementScale) ? displacementScale[0] : displacementScale
  const scaleValue = (scale / 10) * 0.5

  useEffect(() => {
    if (depthTexture) {
      textureRef.current = depthTexture
      setTexture(depthTexture)
      return
    }
    const loader = new THREE.TextureLoader()
    loader.load(
      DEFAULT_DEPTH_MAP_URL,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        textureRef.current = tex
        setTexture(tex)
      },
      undefined,
      () => setTexture(null)
    )
    return () => {
      if (textureRef.current && !depthTexture) {
        textureRef.current.dispose()
        textureRef.current = null
      }
    }
  }, [depthTexture])

  useEffect(() => {
    const mat = matRef.current
    if (!mat) return
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uIsAdjustMode = { value: isAdjustMode ? 1.0 : 0.0 }
      shader.uniforms.uCaseWidth = { value: caseWidth }
      shader.uniforms.uCaseHeight = { value: caseHeight }
      shader.vertexShader =
        `
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
      shader.fragmentShader =
        `
        uniform float uIsAdjustMode;
        uniform float uCaseWidth;
        uniform float uCaseHeight;
        varying vec3 vLocalPosition;
        varying vec3 vWorldPosition;
        ` + shader.fragmentShader
          .replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            vec2 wp = vec2(vWorldPosition.x, vWorldPosition.z);
            bool outside = abs(wp.x) > (uCaseWidth * 0.5) || abs(wp.y) > (uCaseHeight * 0.5);
            vec4 diffuseColor = vec4( diffuse, opacity );
            if (outside) {
              if (uIsAdjustMode > 0.5) {
                diffuseColor = mix(diffuseColor, vec4(1.0, 0.0, 0.0, 0.5), 0.6);
              } else {
                discard;
              }
            }
            `
          )
      mat.userData.shader = shader
    }
    mat.needsUpdate = true
  }, [isAdjustMode, caseWidth, caseHeight])

  useFrame(() => {
    const mat = matRef.current
    const shader = mat?.userData?.shader
    if (shader) {
      shader.uniforms.uIsAdjustMode.value = isAdjustMode ? 1.0 : 0.0
      shader.uniforms.uCaseWidth.value = caseWidth
      shader.uniforms.uCaseHeight.value = caseHeight
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
        onBeforeCompile={(shader) => {
          shader.uniforms.uCaseWidth = { value: caseWidth }
          shader.uniforms.uCaseHeight = { value: caseHeight }
          shader.uniforms.uIsAdjustMode = { value: isAdjustMode ? 1.0 : 0.0 }
          matRef.current.userData.shader = shader
          shader.vertexShader =
            `
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
          shader.fragmentShader =
            `
            uniform float uIsAdjustMode;
            uniform float uCaseWidth;
            uniform float uCaseHeight;
            varying vec3 vLocalPosition;
            varying vec3 vWorldPosition;
            ` + shader.fragmentShader
              .replace(
                'vec4 diffuseColor = vec4( diffuse, opacity );',
                `
                vec2 wp = vec2(vWorldPosition.x, vWorldPosition.z);
                bool outside = abs(wp.x) > (uCaseWidth * 0.5) || abs(wp.y) > (uCaseHeight * 0.5);
                vec4 diffuseColor = vec4( diffuse, opacity );
                if (outside) {
                  if (uIsAdjustMode > 0.5) {
                    diffuseColor = mix(diffuseColor, vec4(1.0, 0.0, 0.0, 0.5), 0.6);
                  } else {
                    discard;
                  }
                }
                `
              )
        }}
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
  isGenerated,
  isAdjustMode,
  reliefPosition,
  reliefSize,
  reliefHeight,
  reliefRotation,
  depthMapUrl,
}) {
  const meshRef = useRef(null)
  const [planeDims, setPlaneDims] = useState({ w: 7, h: 7 })
  const [depthTex, setDepthTex] = useState(null)
  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(planeDims.w, planeDims.h, 256, 256)
  }, [planeDims.w, planeDims.h])

  const sizeVal = Array.isArray(reliefSize) ? reliefSize[0] : reliefSize
  const scale = 0.3 + ((sizeVal - 20) / 180) * 2.2
  useEffect(() => {
    const loader = new THREE.TextureLoader()
    const url = depthMapUrl || DEFAULT_DEPTH_MAP_URL
    loader.load(
      url,
      (tex) => {
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
  }, [depthMapUrl])
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
      position={[reliefPosition.x, RELIEF_Y, reliefPosition.y]}
      scale={[scale, scale, 1]}
      castShadow
      receiveShadow
    >
      <ReliefClippedMaterial
        isGenerated={isGenerated}
        displacementScale={reliefHeight}
        isAdjustMode={isAdjustMode}
        caseWidth={PHONE_W}
        caseHeight={PHONE_H}
        depthTexture={depthTex}
      />
    </mesh>
  )
}

function AdjustCapturePlane({ isAdjustMode, reliefPosition, onReliefPositionChange }) {
  const dragOffsetRef = useRef(null)
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
      const p = e.point
      const newPos = { x: p.x - dragOffsetRef.current.dx, y: p.z - dragOffsetRef.current.dz }
      onReliefPositionChange(newPos)
    },
    [isAdjustMode, onReliefPositionChange]
  )
  const onPointerUp = useCallback((e) => {
    if (!isAdjustMode) return
    e.target.releasePointerCapture(e.pointerId)
    dragOffsetRef.current = null
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
      position={[0, RELIEF_Y, 0]}
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

function PhoneCaseBox({ isAdjustMode }) {
  const boxRef = useRef(null)
  const originalRaycastRef = useRef(null)
  useEffect(() => {
    if (!boxRef.current) return
    const mesh = boxRef.current
    if (!originalRaycastRef.current) originalRaycastRef.current = mesh.raycast.bind(mesh)
    if (isAdjustMode) {
      mesh.raycast = () => {}
    } else {
      mesh.raycast = originalRaycastRef.current
    }
  }, [isAdjustMode])
  return (
    <mesh ref={boxRef} position={[0, 0, 0]} receiveShadow>
      <boxGeometry args={[PHONE_W, PHONE_T, PHONE_H]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  )
}

export function Scene3D({
  isGenerated,
  isAdjustMode,
  reliefPosition,
  onReliefPositionChange,
  embossHeight,
  embossSize,
  reliefRotation,
  depthMapUrl,
}) {
  const controlsRef = useRef(null)

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />

      <group>
        <PhoneCaseBox isAdjustMode={isAdjustMode} />
        <ReliefPlane
          isGenerated={isGenerated}
          isAdjustMode={isAdjustMode}
          reliefPosition={reliefPosition}
          reliefSize={embossSize}
          reliefHeight={embossHeight}
          reliefRotation={reliefRotation}
          depthMapUrl={depthMapUrl}
        />
        {(isAdjustMode && isGenerated) && (
          <AdjustCapturePlane
            isAdjustMode={isAdjustMode}
            reliefPosition={reliefPosition}
            onReliefPositionChange={onReliefPositionChange}
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

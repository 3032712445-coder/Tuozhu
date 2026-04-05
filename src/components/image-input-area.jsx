import { useState, useEffect } from "react"

export function ImageInputArea({
  uploadedImage,
  onImageUpload,
  aiPrompt,
  onAiPromptChange,
  onAiGenerate,
  isGenerating,
  isDepthGenerating,
  onHistoryImageSelect,
  phoneModel,
}) {
console.log("🔥 ImageInputArea 加载成功")
const [showHistory, setShowHistory] = useState(false)
const [historyImages, setHistoryImages] = useState([])

const handleFile = (e) => {
  // 检查是否正在生成图片
  if (isGenerating) {
    alert("请等待生图完毕")
    // 清空文件输入，避免用户再次点击时直接上传
    e.target.value = ''
    return
  }
  
  // 检查是否选择了手机型号
  if (!phoneModel) {
    alert("请先选择手机型号")
    // 清空文件输入，避免用户再次点击时直接上传
    e.target.value = ''
    return
  }
  
  const file = e.target.files?.[0]
  if (!file) return

  const url = URL.createObjectURL(file)

  console.log("子组件 file:", file, file instanceof File)
  console.log("子组件 url:", url)

  // 顺序：先 file，后 url
  onImageUpload(file, url)
}

const fetchHistoryImages = async () => {
  try {
    const response = await fetch('http://localhost:8000/history')
    if (response.ok) {
      const data = await response.json()
      setHistoryImages(data.images || [])
    }
  } catch (error) {
    console.error('Failed to fetch history images:', error)
  }
}

const handleHistoryClick = () => {
  // 检查是否正在生成图片
  if (isGenerating) {
    alert("请等待生图完毕")
    return
  }
  
  setShowHistory(true)
  fetchHistoryImages()
}

const handleImageSelect = (image) => {
  // 检查是否正在生成图片
  if (isGenerating) {
    alert("请等待生图完毕")
    return
  }
  
  if (onHistoryImageSelect) {
    onHistoryImageSelect(image)
  }
  setShowHistory(false)
}

const handleOutsideClick = (e) => {
  if (e.target.className.includes('history-overlay')) {
    setShowHistory(false)
  }
}

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-foreground">
        上传图片 / AI 生成
      </label>

      <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
        {uploadedImage ? (
          <img
            src={uploadedImage}
            alt="上传"
            className="mx-auto max-h-32 rounded object-contain"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            拖拽或点击上传
          </p>
        )}

        <input
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="mt-2 text-sm"
        />
      </div>

      <input
        type="text"
        placeholder="AI 描述（可选）"
        value={aiPrompt}
        onChange={(e) => onAiPromptChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />

      <div className="flex space-x-2">
        <button
          type="button"
          onClick={onAiGenerate}
          disabled={isGenerating}
          className="flex-1 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
        >
          {isGenerating ? "生成中…" : "AI 生成"}
        </button>
        <button
          type="button"
          onClick={handleHistoryClick}
          className="rounded-md bg-background border border-border px-3 py-2 text-sm font-medium text-foreground"
        >
          历史记录
        </button>
      </div>

      {isDepthGenerating && (
        <p className="text-xs text-muted-foreground">
          正在计算 3D 深度信息...
        </p>
      )}

      {showHistory && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center history-overlay" onClick={handleOutsideClick}>
          <div className="bg-background rounded-lg p-4 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium mb-4">历史记录</h3>
            {historyImages.length > 0 ? (
              <div className="space-y-3">
                {historyImages.map((image, index) => (
                  <div key={index} className="cursor-pointer hover:bg-muted/50 rounded p-2">
                    <img
                      src={image.url}
                      alt={`历史图片 ${index + 1}`}
                      className="w-full h-32 object-cover rounded mb-2"
                    />
                    <p className="text-xs text-muted-foreground">{image.timestamp}</p>
                    <button
                      onClick={() => handleImageSelect(image)}
                      className="mt-2 rounded-md bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                    >
                      使用此图片
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无历史记录</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
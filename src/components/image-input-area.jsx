export function ImageInputArea({ uploadedImage, onImageUpload, aiPrompt, onAiPromptChange, onAiGenerate, isGenerating }) {
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      onImageUpload(url)
    }
  }
  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-foreground">上传图片 / AI 生成</label>
      <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
        {uploadedImage ? (
          <img src={uploadedImage} alt="上传" className="mx-auto max-h-32 rounded object-contain" />
        ) : (
          <p className="text-sm text-muted-foreground">拖拽或点击上传</p>
        )}
        <input type="file" accept="image/*" onChange={handleFile} className="mt-2 text-sm" />
      </div>
      <input
        type="text"
        placeholder="AI 描述（可选）"
        value={aiPrompt}
        onChange={(e) => onAiPromptChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={onAiGenerate}
        disabled={isGenerating}
        className="rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
      >
        {isGenerating ? "生成中…" : "AI 生成"}
      </button>
    </div>
  )
}

export function EmbossParameters({
  height,
  size,
  rotation,
  onHeightChange,
  onSizeChange,
  onRotationChange,
}) {
  return (
    <div className="space-y-4">
      <label className="text-sm font-medium text-foreground">浮雕参数</label>
      <div>
        <span className="text-xs text-muted-foreground">高度</span>
        <input
          type="range"
          min="1"
          max="10"
          value={height[0]}
          onChange={(e) => onHeightChange([Number(e.target.value)])}
          className="w-full"
        />
        <span className="text-xs">{height[0]}mm</span>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">大小</span>
        <input
          type="range"
          min="20"
          max="200"
          value={size[0]}
          onChange={(e) => onSizeChange([Number(e.target.value)])}
          className="w-full"
        />
        <span className="text-xs">{size[0]}%</span>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">旋转</span>
        <input
          type="range"
          min="0"
          max="360"
          value={rotation}
          onChange={(e) => onRotationChange(Number(e.target.value))}
          className="w-full"
        />
        <span className="text-xs">{rotation}°</span>
      </div>
    </div>
  )
}

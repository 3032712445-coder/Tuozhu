export function PhoneModelSelector({ value, onValueChange }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">手机型号</label>
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        <option value="">请选择型号</option>
        <option value="iphone15">iPhone 15</option>
        <option value="iphone15pro">iPhone 15 Pro</option>
        <option value="xiaomi14">小米 14</option>
      </select>
    </div>
  )
}
